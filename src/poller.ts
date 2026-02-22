import type { Context } from "@fedify/fedify";
import type { FeedsConfig } from "./config.js";
import type { Sql } from "./db.js";
import { fetchFeed } from "./rss.js";
import { publishNewEntries } from "./publisher.js";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface PollerOptions {
  config: FeedsConfig;
  sql: Sql;
  domain: string;
  intervalMs?: number;
  getContext: () => Context<void>;
}

export function startPoller(opts: PollerOptions): { stop: () => void } {
  const { config, sql, domain, getContext } = opts;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  let timer: ReturnType<typeof setInterval> | null = null;

  async function poll(): Promise<void> {
    const ctx = getContext();
    for (const [username, bot] of Object.entries(config.bots)) {
      try {
        const entries = await fetchFeed(bot.feed_url);
        const result = await publishNewEntries(ctx, sql, username, domain, entries);
        if (result.published > 0) {
          console.log(
            `[${username}] published ${result.published}, skipped ${result.skipped}`,
          );
        }
      } catch (err) {
        console.error(`[${username}] polling error:`, err);
      }
    }
  }

  // Run immediately, then on interval
  poll();
  timer = setInterval(poll, intervalMs);

  return {
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
