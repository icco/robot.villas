import type { Context } from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import type { BotConfig, FeedsConfig } from "./config";
import { mapWithConcurrency } from "./concurrency";
import { getFeedPollStatusMap, upsertFeedPollStatus, type Db, type FeedPollStatusRow } from "./db";
import { parsePositiveInt } from "./env";
import { fetchFeedWithHttpResult } from "./rss";
import { publishNewEntries } from "./publisher";

/** Not configurable: a 429 backs a slow-polling host off on its own. */
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
/** How many bot feeds to poll at once. Keeps a large feeds.yml from making a
 * poll cycle run far longer than intervalMs when polled fully sequentially. */
const DEFAULT_CONCURRENCY = 10;
const logger = getLogger(["robot-villas", "poller"]);

export interface PollerOptions {
  config: FeedsConfig;
  db: Db;
  domain: string;
  /** Tests only. */
  intervalMs?: number;
  concurrency?: number;
  getContext: () => Context<void>;
}

export function startPoller(opts: PollerOptions): { stop: () => void } {
  const { config, db, domain, getContext } = opts;
  const intervalMs = parsePositiveInt(opts.intervalMs, DEFAULT_INTERVAL_MS);
  const concurrency = parsePositiveInt(opts.concurrency, DEFAULT_CONCURRENCY);
  const botNames = Object.keys(config.bots);

  let stopped = false;

  logger.info(
    "Starting: {botCount} bot(s) [{botNames}], interval {intervalMs}ms, concurrency {concurrency}",
    { botCount: botNames.length, botNames: botNames.join(", "), intervalMs, concurrency },
  );

  async function pollBot(
    ctx: Context<void>,
    username: string,
    bot: BotConfig,
    previous: FeedPollStatusRow | undefined,
  ): Promise<void> {
    const checkedAt = new Date();
    try {
      // Don't touch the status row while backing off, so /status keeps showing the 429.
      if (previous?.nextPollAt && previous.nextPollAt.getTime() > checkedAt.getTime()) {
        logger.debug("Skipping {username}: backing off until {nextPollAt}", {
          username,
          nextPollAt: previous.nextPollAt.toISOString(),
        });
        return;
      }
      // The interval is process-local, so without this a restart re-fetches every feed.
      const sinceLastCheck = checkedAt.getTime() - (previous?.lastCheckedAt.getTime() ?? 0);
      if (previous && sinceLastCheck < intervalMs) {
        logger.debug("Skipping {username}: checked {sinceLastCheck}ms ago", {
          username,
          sinceLastCheck,
        });
        return;
      }
      const fetchResult = await fetchFeedWithHttpResult(bot.feed_url, {
        etag: previous?.etag ?? null,
        lastModified: previous?.lastModified ?? null,
      });
      await upsertFeedPollStatus(db, {
        botUsername: username,
        lastCheckedAt: checkedAt,
        lastHttpStatus: fetchResult.httpStatus,
        lastError: fetchResult.errorMessage,
        etag: fetchResult.validators ? fetchResult.validators.etag : (previous?.etag ?? null),
        lastModified: fetchResult.validators
          ? fetchResult.validators.lastModified
          : (previous?.lastModified ?? null),
        nextPollAt:
          fetchResult.retryAfterMs == null
            ? null
            : new Date(checkedAt.getTime() + fetchResult.retryAfterMs),
      });
      if (fetchResult.errorMessage) {
        logger.warn("Feed poll failed for {username}: {message}", {
          username,
          message: fetchResult.errorMessage,
        });
        return;
      }
      if (fetchResult.notModified) {
        logger.info("Feed unchanged for {username} (HTTP 304)", { username });
        return;
      }
      const result = await publishNewEntries(ctx, db, username, domain, fetchResult.entries, bot);
      logger.info(
        "Fetched {entryCount} entries for {username}, published {published}, skipped {skipped}",
        {
          username,
          entryCount: fetchResult.entries.length,
          published: result.published,
          skipped: result.skipped,
        },
      );
    } catch (err) {
      logger.error("Error polling {username}: {error}", { username, error: err });
    }
  }

  async function poll(): Promise<void> {
    logger.info("Poll cycle starting");
    const ctx = getContext();
    let statuses: Map<string, FeedPollStatusRow>;
    try {
      statuses = await getFeedPollStatusMap(db, botNames);
    } catch (err) {
      // Without stored validators we still poll, just unconditionally.
      logger.error("Could not load feed poll status: {error}", { error: err });
      statuses = new Map();
    }
    await mapWithConcurrency(
      Object.entries(config.bots),
      concurrency,
      ([username, bot]) => pollBot(ctx, username, bot, statuses.get(username)),
    );
    logger.info("Poll cycle complete");
  }

  async function loop(): Promise<void> {
    while (!stopped) {
      await poll();
      if (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  }

  loop();

  return {
    stop() {
      stopped = true;
    },
  };
}
