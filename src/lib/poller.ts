import type { Context } from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import { resolveBlockedInstances, type RssBotConfig, type FeedsConfig } from "./config";
import { mapWithConcurrency } from "./concurrency";
import { claimFeedPoll, getFeedPollStatusMap, releaseFeedPoll, renewFeedPoll, upsertFeedPollStatus, type Db, type FeedPollStatusRow } from "./db";
import { parsePositiveInt } from "./env";
import { fetchFeedWithHttpResult } from "./rss";
import { publishNewEntries } from "./publisher";
import { announceNewBots } from "./meta-bot";
import { prunePublications, submitPendingPublications } from "./publications";

/** Not configurable: a 429 backs a slow-polling host off on its own. */
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
/** How many bot feeds to poll at once. Keeps a large feeds.yml from making a
 * poll cycle run far longer than intervalMs when polled fully sequentially. */
const DEFAULT_CONCURRENCY = 10;
const logger = getLogger(["robot-villas", "poller"]);
/** Covers fetch plus ingestion (including hashtag generation); expires if a replica dies. */
const FEED_LEASE_MS = 10 * 60 * 1000;

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
  const rssBots = Object.entries(config.bots).filter(
    (entry): entry is [string, RssBotConfig] => !!entry[1].feed_url,
  );
  const botNames = rssBots.map(([username]) => username);
  // Resolved once per poller, not per entry: the list only changes on redeploy.
  const blockedInstances = resolveBlockedInstances(config);

  let stopped = false;

  logger.info(
    "Starting: {botCount} bot(s) [{botNames}], interval {intervalMs}ms, concurrency {concurrency}",
    { botCount: botNames.length, botNames: botNames.join(", "), intervalMs, concurrency },
  );

  async function pollBot(
    ctx: Context<void>,
    username: string,
    bot: RssBotConfig,
    previous: FeedPollStatusRow | undefined,
  ): Promise<void> {
    const checkedAt = new Date();
    let claimToken: string | null = null;
    let renewal: ReturnType<typeof setInterval> | undefined;
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
      claimToken = await claimFeedPoll(db, username, checkedAt, FEED_LEASE_MS);
      if (!claimToken) {
        logger.debug("Skipping {username}: another replica is polling it", { username });
        return;
      }
      const token = claimToken;
      // Renew while working; ingestion (with hashtag generation) can outlast one lease.
      renewal = setInterval(() => {
        renewFeedPoll(db, username, token, new Date(Date.now() + FEED_LEASE_MS))
          .then((held) => {
            if (!held) {
              logger.warn("Lost poll lease for {username}; its result will be discarded", { username });
            }
          })
          .catch((error) => logger.warn("Could not renew poll lease for {username}: {error}", { username, error }));
      }, FEED_LEASE_MS / 3);
      const fetchResult = await fetchFeedWithHttpResult(bot.feed_url, {
        etag: previous?.etag ?? null,
        lastModified: previous?.lastModified ?? null,
      });
      if (!fetchResult.errorMessage && !fetchResult.notModified) {
        // Advancing validators is safe only after every entry and submission
        // intent is committed. Partial ingestion retries using the old validators.
        const result = await publishNewEntries(ctx, db, username, domain, fetchResult.entries, bot, blockedInstances);
        logger.info("Ingested {stored} posts for {username}, skipped {skipped}", { username, ...result });
      }
      // Fenced by the token: entry inserts are idempotent per guid, but only the
      // current lease holder may advance validators and status.
      const recorded = await upsertFeedPollStatus(db, {
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
      }, claimToken);
      claimToken = null;
      if (!recorded) {
        logger.warn("Discarded poll status for {username}: lease was taken over", { username });
        return;
      }
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
    } catch (err) {
      logger.error("Error polling {username}: {error}", { username, error: err });
    } finally {
      clearInterval(renewal);
      if (claimToken) {
        await releaseFeedPoll(db, username, claimToken).catch((error) => {
          logger.warn("Could not release poll lease for {username}: {error}", { username, error });
        });
      }
    }
  }

  async function poll(): Promise<void> {
    logger.info("Poll cycle starting");
    const ctx = getContext();
    try {
      const submissions = await submitPendingPublications(ctx, db, domain, Object.keys(config.bots), blockedInstances);
      logger.info("Publication submissions: {queued} queued, {failed} failed, {cancelled} cancelled", submissions);
      await prunePublications(db);
    } catch (error) {
      logger.error("Publication retry failed: {error}", { error });
    }
    try {
      await announceNewBots(ctx, db, config, domain);
    } catch (err) {
      logger.error("New bot announcements failed: {error}", { error: err });
    }
    let statuses: Map<string, FeedPollStatusRow>;
    try {
      statuses = await getFeedPollStatusMap(db, botNames);
    } catch (err) {
      // Without stored validators we still poll, just unconditionally.
      logger.error("Could not load feed poll status: {error}", { error: err });
      statuses = new Map();
    }
    await mapWithConcurrency(
      rssBots,
      concurrency,
      ([username, bot]) => pollBot(ctx, username, bot, statuses.get(username)),
    );
    try {
      await submitPendingPublications(ctx, db, domain, Object.keys(config.bots), blockedInstances);
    } catch (error) {
      logger.error("Publication submission failed: {error}", { error });
    }
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
