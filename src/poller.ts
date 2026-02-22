import type { Context } from "@fedify/fedify";
import type { FeedsConfig } from "./config.js";
import type { Db } from "./db.js";
import { fetchFeed } from "./rss.js";
import { publishNewEntries } from "./publisher.js";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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

  console.log(
    `[Poller] Starting: ${botNames.length} bot(s) [${botNames.join(", ")}], interval ${intervalMs}ms`,
  );

  async function poll(): Promise<void> {
    console.log("[Poller] Poll cycle starting");
    const ctx = getContext();
    for (const [username, bot] of Object.entries(config.bots)) {
      try {
        const entries = await fetchFeed(bot.feed_url);
        const result = await publishNewEntries(ctx, db, username, domain, entries);
        console.log(
          `[Poller] [${username}] fetched ${entries.length} entries, published ${result.published}, skipped ${result.skipped}`,
        );
      } catch (err) {
        console.error(`[Poller] [${username}] error:`, err);
      }
    }
    console.log("[Poller] Poll cycle complete");
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
