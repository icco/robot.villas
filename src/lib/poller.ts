import type { Context } from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import type { BotConfig, FeedsConfig } from "./config";
import { mapWithConcurrency } from "./concurrency";
import { upsertFeedPollStatus, type Db } from "./db";
import { parsePositiveInt } from "./env";
import { fetchFeedWithHttpResult } from "./rss";
import { publishNewEntries } from "./publisher";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
/** How many bot feeds to poll at once. Keeps a large feeds.yml from making a
 * poll cycle run far longer than intervalMs when polled fully sequentially. */
const DEFAULT_CONCURRENCY = 10;
const logger = getLogger(["robot-villas", "poller"]);

export interface PollerOptions {
  config: FeedsConfig;
  db: Db;
  domain: string;
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

  async function pollBot(ctx: Context<void>, username: string, bot: BotConfig): Promise<void> {
    const checkedAt = new Date();
    try {
      const fetchResult = await fetchFeedWithHttpResult(bot.feed_url);
      await upsertFeedPollStatus(
        db,
        username,
        checkedAt,
        fetchResult.httpStatus,
        fetchResult.errorMessage,
      );
      if (fetchResult.errorMessage) {
        logger.warn("Feed poll failed for {username}: {message}", {
          username,
          message: fetchResult.errorMessage,
        });
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
    await mapWithConcurrency(
      Object.entries(config.bots),
      concurrency,
      ([username, bot]) => pollBot(ctx, username, bot),
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
