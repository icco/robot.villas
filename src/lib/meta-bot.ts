import type { Context } from "@fedify/fedify";
import { resolveBlockedInstances, type FeedsConfig } from "./config";
import { getEntryByGuid, getPendingBotAnnouncements, insertEntry, markBotsAnnounced, type Db } from "./db";
import { buildCreateActivity, getPublishRecipients, sendCreateActivity } from "./publisher";

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

  const recipients = await getPublishRecipients(db, "meta", resolveBlockedInstances(config));
  for (const { botUsername, createdAt } of pending) {
    const bot = config.bots[botUsername];
    const guid = `new-bot:${botUsername}`;
    await insertEntry(
      db, "meta", guid,
      new URL(`/@${botUsername}`, `https://${domain}`).href,
      `New bot: ${bot.display_name} (@${botUsername}@${domain}). ${bot.summary}`,
      createdAt, [],
    );
    const entry = await getEntryByGuid(db, "meta", guid);
    if (!entry) {
      throw new Error(`Missing announcement for ${botUsername}`);
    }
    // Retries reuse the stored content and activity ID.
    const activity = buildCreateActivity("meta", entry.id, {
      title: entry.title,
      link: entry.url,
      publishedAt: entry.publishedAt,
      hashtags: entry.hashtags,
    }, `https://${domain}`);
    if (await sendCreateActivity(ctx, "meta", activity, recipients)) {
      await markBotsAnnounced(db, [botUsername]);
    }
  }
}
