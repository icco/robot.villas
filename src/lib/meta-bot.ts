import type { Context } from "@fedify/fedify";
import { resolveBlockedInstances, type FeedsConfig } from "./config";
import { getPendingBotAnnouncements, markBotsAnnounced, type Db } from "./db";
import { publishNewEntries } from "./publisher";

export async function announceNewBots(
  ctx: Context<void>,
  db: Db,
  config: FeedsConfig,
  domain: string,
): Promise<void> {
  if (!config.meta) {
    return;
  }
  const usernames = Object.keys(config.bots).filter((username) => username !== "meta");
  const pending = await getPendingBotAnnouncements(db, usernames);
  if (pending.length === 0) {
    return;
  }

  await publishNewEntries(
    ctx,
    db,
    "meta",
    domain,
    pending.map(({ botUsername, createdAt }) => ({
      guid: `new-bot:${botUsername}`,
      title: `New bot: ${config.bots[botUsername].display_name} (@${botUsername}@${domain}). ${config.bots[botUsername].summary}`,
      link: new URL(`/@${botUsername}`, `https://${domain}`).href,
      publishedAt: createdAt,
      feedCategories: [],
    })),
    config.bots.meta,
    resolveBlockedInstances(config),
  );
  // Stable GUIDs prevent duplicate posts if this update fails.
  await markBotsAnnounced(db, pending.map(({ botUsername }) => botUsername));
}
