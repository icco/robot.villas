import { Temporal } from "@js-temporal/polyfill";
import type { Context } from "@fedify/fedify";
import { Create, Note, PUBLIC_COLLECTION, type Recipient } from "@fedify/vocab";
import escapeHtml from "escape-html";
import { getLogger } from "@logtape/logtape";
import { getAcceptedRelays, getFollowers, insertEntry, type Db } from "./db.js";
import type { FeedEntry } from "./rss.js";

const logger = getLogger(["robot-villas", "publisher"]);

/** Max lengths for feed-derived fields (storage and Note content). */
export const MAX_TITLE_LENGTH = 2000;
export const MAX_URL_LENGTH = 2048;
export const MAX_GUID_LENGTH = 2048;

export function truncateToMax(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

/** Content for a Note; id is our server-generated entry id (used in Note URI). */
export interface EntryLike {
  title: string;
  link: string;
  publishedAt: Date | null;
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
): Promise<PublishResult> {
  let published = 0;
  let skipped = 0;

  const followers = await getFollowers(db, botUsername);
  const relays = await getAcceptedRelays(db);
  const relayRecipients: Recipient[] = relays
    .filter((r) => r.inboxUrl && r.actorId)
    .map((r) => ({
      id: new URL(r.actorId!),
      inboxId: new URL(r.inboxUrl!),
      endpoints: null,
    }));

  const hasRecipients = followers.length > 0 || relayRecipients.length > 0;

  for (const entry of entries) {
    const guid = truncateToMax(entry.guid, MAX_GUID_LENGTH);
    const url = truncateToMax(entry.link, MAX_URL_LENGTH);
    const title = truncateToMax(entry.title, MAX_TITLE_LENGTH);

    const entryId = await insertEntry(
      db,
      botUsername,
      guid,
      url,
      title,
      entry.publishedAt,
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
      { title, link: url, publishedAt: entry.publishedAt },
      `https://${domain}`,
    );

    if (followers.length > 0) {
      await ctx.sendActivity(
        { identifier: botUsername },
        "followers",
        create,
      );
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

/** Returns a URL only for http: or https:; otherwise undefined. Used for Note.url and hrefs. */
export function safeParseUrl(link: string | undefined): URL | undefined {
  if (!link) return undefined;
  try {
    const url = new URL(link);
    if (url.protocol === "http:" || url.protocol === "https:") return url;
    return undefined;
  } catch {
    return undefined;
  }
}

function formatContent(entry: EntryLike): string {
  const safeUrl = safeParseUrl(entry.link);
  if (safeUrl) {
    const href = safeUrl.href;
    return `<p>${escapeHtml(entry.title)}</p><p><a href="${escapeHtml(href)}">${escapeHtml(href)}</a></p>`;
  }
  return `<p>${escapeHtml(entry.title)}</p>`;
}
