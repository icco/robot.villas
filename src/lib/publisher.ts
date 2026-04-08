import { Temporal } from "@js-temporal/polyfill";
import type { Context } from "@fedify/fedify";
import { Create, Hashtag, Note, PUBLIC_COLLECTION, type Recipient } from "@fedify/vocab";
import escapeHtml from "escape-html";
import { getLogger } from "@logtape/logtape";
import type { BotConfig } from "./config";
import { getAcceptedRelays, getFollowerRecipients, hasEntry, insertEntry, type Db } from "./db";
import { resolveHashtags } from "./hashtags";
import type { FeedEntry } from "./rss";

const logger = getLogger(["robot-villas", "publisher"]);

export const MAX_TITLE_LENGTH = 2000;
export const MAX_URL_LENGTH = 2048;
export const MAX_GUID_LENGTH = 2048;

export function truncateToMax(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return s.slice(0, max);
}

export interface EntryLike {
  title: string;
  link: string;
  publishedAt: Date | null;
  /** Hashtag labels (no leading #), at most three. */
  hashtags: string[];
}

/**
 * Builds a Create(Note) activity. Uses entryId (our DB id) in the Note URI, not
 * the feed's guid, so feed-supplied data never appears in URLs.
 */
export function buildCreateActivity(
  botUsername: string,
  entryId: number,
  entry: EntryLike,
  baseUrl: string | URL,
): Create {
  const noteId = new URL(`/users/${botUsername}/posts/${entryId}`, baseUrl);
  const actorId = new URL(`/users/${botUsername}`, baseUrl);
  const followersId = new URL(`/users/${botUsername}/followers`, baseUrl);

  const hashtagTags = entry.hashtags
    .filter(Boolean)
    .map(
      (h) =>
        new Hashtag({
          href: new URL(`/tags/${encodeURIComponent(h)}`, baseUrl),
          name: `#${h}`,
        }),
    );

  const note = new Note({
    id: noteId,
    attribution: actorId,
    to: PUBLIC_COLLECTION,
    cc: followersId,
    content: formatContent(entry),
    mediaType: "text/html",
    url: safeParseUrl(entry.link),
    published: entry.publishedAt
      ? Temporal.Instant.from(entry.publishedAt.toISOString())
      : undefined,
    tags: hashtagTags,
  });

  return new Create({
    id: new URL(`${noteId.href}#activity`),
    actor: actorId,
    object: note,
    tos: [PUBLIC_COLLECTION],
    ccs: [followersId],
  });
}

export interface PublishResult {
  published: number;
  skipped: number;
}

export async function publishNewEntries(
  ctx: Context<void>,
  db: Db,
  botUsername: string,
  domain: string,
  entries: FeedEntry[],
  bot: BotConfig,
): Promise<PublishResult> {
  let published = 0;
  let skipped = 0;

  const followerRows = await getFollowerRecipients(db, botUsername);
  const followerRecipients: Recipient[] = followerRows
    .filter((f) => f.sharedInboxUrl)
    .map((f) => ({
      id: new URL(f.followerId),
      inboxId: new URL(f.sharedInboxUrl!),
      endpoints: null,
    }));
  const relays = await getAcceptedRelays(db);
  const relayRecipients: Recipient[] = relays
    .filter((r) => r.inboxUrl && r.actorId)
    .map((r) => ({
      id: new URL(r.actorId!),
      inboxId: new URL(r.inboxUrl!),
      endpoints: null,
    }));

  const hasRecipients = followerRecipients.length > 0 || relayRecipients.length > 0;

  for (const entry of entries) {
    const guid = truncateToMax(entry.guid, MAX_GUID_LENGTH);
    const url = truncateToMax(entry.link, MAX_URL_LENGTH);
    const title = truncateToMax(entry.title, MAX_TITLE_LENGTH);

    if (await hasEntry(db, botUsername, guid)) {
      skipped++;
      continue;
    }

    const hashtags = await resolveHashtags(
      { ...entry, title, link: url },
      botUsername,
      bot,
    );

    const entryId = await insertEntry(
      db,
      botUsername,
      guid,
      url,
      title,
      entry.publishedAt,
      [...hashtags],
    );

    if (entryId === null) {
      skipped++;
      continue;
    }

    if (!hasRecipients) {
      skipped++;
      continue;
    }

    const create = buildCreateActivity(
      botUsername,
      entryId,
      { title, link: url, publishedAt: entry.publishedAt, hashtags },
      `https://${domain}`,
    );

    if (followerRecipients.length > 0) {
      try {
        await ctx.sendActivity(
          { identifier: botUsername },
          followerRecipients,
          create,
        );
      } catch (error) {
        logger.error("Failed to send to followers for {botUsername}: {error}", {
          botUsername,
          error,
        });
      }
    }

    for (const relay of relayRecipients) {
      try {
        await ctx.sendActivity(
          { identifier: botUsername },
          relay,
          create,
        );
      } catch (error) {
        logger.error("Failed to send to relay {relayId}: {error}", {
          relayId: relay.id?.href,
          error,
        });
      }
    }

    published++;
  }

  return { published, skipped };
}

export function safeParseUrl(link: string | undefined): URL | undefined {
  if (!link) {
    return undefined;
  }
  try {
    const url = new URL(link);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function formatContent(entry: EntryLike): string {
  const safeUrl = safeParseUrl(entry.link);
  const tags = entry.hashtags.filter(Boolean);
  const tagsHtml =
    tags.length > 0 ? `<p>${tags.map((h) => `#${escapeHtml(h)}`).join(" ")}</p>` : "";
  if (safeUrl) {
    const href = safeUrl.href;
    return `<p>${escapeHtml(entry.title)}</p><p><a href="${escapeHtml(href)}">${escapeHtml(href)}</a></p>${tagsHtml}`;
  }
  return `<p>${escapeHtml(entry.title)}</p>${tagsHtml}`;
}
