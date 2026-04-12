import type { Context } from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import type { FeedsConfig } from "./config";
import { upsertFeedPollStatus, type Db } from "./db";
import { fetchFeedWithHttpResult } from "./rss";
import { publishNewEntries } from "./publisher";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const logger = getLogger(["robot-villas", "poller"]);

export interface PollerOptions {
  config: FeedsConfig;
  db: Db;
  domain: string;
  intervalMs?: number;
  getContext: () => Context<void>;
}

export function startPoller(opts: PollerOptions): { stop: () => void } {
  const { config, db, domain, getContext } = opts;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const botNames = Object.keys(config.bots);

  let stopped = false;

  logger.info(
    "Starting: {botCount} bot(s) [{botNames}], interval {intervalMs}ms",
    { botCount: botNames.length, botNames: botNames.join(", "), intervalMs },
  );

  async function poll(): Promise<void> {
    logger.info("Poll cycle starting");
    const ctx = getContext();
    for (const [username, bot] of Object.entries(config.bots)) {
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
          continue;
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
