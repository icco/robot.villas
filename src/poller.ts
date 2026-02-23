import type { Context } from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import type { FeedsConfig } from "./config.js";
import type { Db } from "./db.js";
import { fetchFeed } from "./rss.js";
import { publishNewEntries } from "./publisher.js";

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
      try {
        const entries = await fetchFeed(bot.feed_url);
        const result = await publishNewEntries(ctx, db, username, domain, entries);
        logger.info(
          "Fetched {entryCount} entries for {username}, published {published}, skipped {skipped}",
          { username, entryCount: entries.length, published: result.published, skipped: result.skipped },
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
