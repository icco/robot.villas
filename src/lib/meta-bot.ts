import type { Context } from "@fedify/fedify";
import { resolveBlockedInstances, type FeedsConfig } from "./config";
import { getPendingBotAnnouncements, markBotsAnnounced, type Db } from "./db";
import { publishNewEntries } from "./publisher";

/** Called at startup and on each poll cycle; both discovery and post dedup survive restarts. */
export async function announceNewBots(
  ctx: Context<void>,
  db: Db,
  config: FeedsConfig,
  domain: string,
): Promise<void> {
  const meta = Object.entries(config.bots).find(([, bot]) => bot.type === "meta");
  if (!meta) {
    return;
  }
  const [metaUsername, metaBot] = meta;
  const usernames = Object.keys(config.bots).filter((username) => username !== metaUsername);
  const pending = await getPendingBotAnnouncements(db, usernames);
  if (pending.length === 0) {
    return;
  }

  await publishNewEntries(
    ctx,
    db,
    metaUsername,
    domain,
    pending.map(({ botUsername, createdAt }) => ({
      guid: `new-bot:${botUsername}`,
      title: `Welcome ${config.bots[botUsername].display_name} (@${botUsername}@${domain}) to ${domain}! ${config.bots[botUsername].summary}`,
      link: new URL(`/@${botUsername}`, `https://${domain}`).href,
      publishedAt: createdAt,
      feedCategories: [],
    })),
    metaBot,
    resolveBlockedInstances(config),
  );
  // A failed publish leaves discovery state pending for the next cycle. Stable GUIDs
  // also prevent duplicates if a process exits between publishing and this update.
  await markBotsAnnounced(db, pending.map(({ botUsername }) => botUsername));
}
