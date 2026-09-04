import { Temporal as TemporalPolyfill } from "@js-temporal/polyfill";
import type { Context } from "@fedify/fedify";
import { Create, Hashtag, Note, PUBLIC_COLLECTION, type Recipient } from "@fedify/vocab";
import escapeHtml from "escape-html";
import { getLogger } from "@logtape/logtape";
import { partitionBlockedRecipients } from "./blocklist";
import type { BotConfig } from "./config";
import { getAcceptedRelays, getExistingGuids, getFollowerRecipients, insertEntry, type Db } from "./db";
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
          href: new URL(`/tags/${encodeURIComponent(h.toLowerCase())}`, baseUrl),
          name: `#${h}`,
        }),
    );

  const note = new Note({
    id: noteId,
    attribution: actorId,
    to: PUBLIC_COLLECTION,
    cc: followersId,
    content: formatContent(entry, baseUrl),
    mediaType: "text/html",
    url: safeParseUrl(entry.link),
    published: entry.publishedAt
      ? (TemporalPolyfill.Instant.from(
          entry.publishedAt.toISOString(),
        ) as unknown as Temporal.Instant)
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
  blockedInstances: ReadonlySet<string> = new Set(),
): Promise<PublishResult> {
  let published = 0;
  let skipped = 0;

  const followerRows = await getFollowerRecipients(db, botUsername);
  const allFollowerRecipients: Recipient[] = followerRows
    .filter((f) => f.sharedInboxUrl)
    .map((f) => ({
      id: new URL(f.followerId),
      inboxId: new URL(f.sharedInboxUrl!),
      endpoints: null,
    }));
  const relays = await getAcceptedRelays(db);
  const allRelayRecipients: Recipient[] = relays
    .filter((r) => r.inboxUrl && r.actorId)
    .map((r) => ({
      id: new URL(r.actorId!),
      inboxId: new URL(r.inboxUrl!),
      endpoints: null,
    }));

  // Blocked hosts are dropped here rather than at follow time: a host can be
  // blocked long after it followed, and rows for it stay in the DB.
  const followers = partitionBlockedRecipients(allFollowerRecipients, blockedInstances);
  const relayed = partitionBlockedRecipients(allRelayRecipients, blockedInstances);
  const followerRecipients = followers.allowed;
  const relayRecipients = relayed.allowed;
  const blockedHosts = [...new Set([...followers.blockedHosts, ...relayed.blockedHosts])];
  if (blockedHosts.length > 0) {
    // Counted, not silent: a blocklist that quietly eats deliveries looks
    // exactly like a delivery bug.
    logger.info("Skipping {count} blocked recipient(s) for {identifier}: {hosts}", {
      identifier: botUsername,
      count: followers.blockedHosts.length + relayed.blockedHosts.length,
      hosts: blockedHosts.join(", "),
    });
  }

  const hasRecipients = followerRecipients.length > 0 || relayRecipients.length > 0;

  const truncatedEntries = entries.map((entry) => ({
    entry,
    guid: truncateToMax(entry.guid, MAX_GUID_LENGTH),
    url: truncateToMax(entry.link, MAX_URL_LENGTH),
    title: truncateToMax(entry.title, MAX_TITLE_LENGTH),
  }));
  // One round trip to find which guids already exist, instead of one query per entry.
  const existingGuids = await getExistingGuids(
    db,
    botUsername,
    [...new Set(truncatedEntries.map((e) => e.guid))],
  );

  for (const { entry, guid, url, title } of truncatedEntries) {
    if (existingGuids.has(guid)) {
      skipped++;
      continue;
    }
    // Mark as seen before processing so a duplicate guid later in the same
    // feed (existingGuids is only a pre-loop DB snapshot) is skipped here
    // too, instead of redundantly resolving hashtags for it.
    existingGuids.add(guid);

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

export function formatContent(entry: EntryLike, baseUrl?: string | URL): string {
  const safeUrl = safeParseUrl(entry.link);
  const tags = entry.hashtags.filter(Boolean);
  const tagsHtml =
    tags.length > 0
      ? `<p>${tags
          .map((h) => {
            const escaped = escapeHtml(h);
            if (baseUrl) {
              const tagHref = new URL(`/tags/${encodeURIComponent(h.toLowerCase())}`, baseUrl).href;
              return `<a href="${escapeHtml(tagHref)}" class="mention hashtag" rel="tag">#<span>${escaped}</span></a>`;
            }
            return `#${escaped}`;
          })
          .join(" ")}</p>`
      : "";
  if (safeUrl) {
    const href = safeUrl.href;
    return `<p>${escapeHtml(entry.title)}</p><p><a href="${escapeHtml(href)}">${escapeHtml(href)}</a></p>${tagsHtml}`;
  }
  return `<p>${escapeHtml(entry.title)}</p>${tagsHtml}`;
}
