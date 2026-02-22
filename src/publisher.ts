import { Temporal } from "@js-temporal/polyfill";
import type { Context } from "@fedify/fedify";
import { Create, Note } from "@fedify/vocab";
import { getFollowers, hasEntry, insertEntry, type Sql } from "./db.js";
import type { FeedEntry } from "./rss.js";

export interface PublishResult {
  published: number;
  skipped: number;
}

export async function publishNewEntries(
  ctx: Context<void>,
  sql: Sql,
  botUsername: string,
  domain: string,
  entries: FeedEntry[],
): Promise<PublishResult> {
  let published = 0;
  let skipped = 0;

  const followers = await getFollowers(sql, botUsername);

  for (const entry of entries) {
    if (await hasEntry(sql, botUsername, entry.guid)) {
      skipped++;
      continue;
    }

    await insertEntry(
      sql,
      botUsername,
      entry.guid,
      entry.link,
      entry.title,
      entry.publishedAt,
    );

    if (followers.length === 0) {
      skipped++;
      continue;
    }

    const noteId = new URL(
      `/users/${botUsername}/posts/${encodeURIComponent(entry.guid)}`,
      `https://${domain}`,
    );
    const actorId = new URL(`/users/${botUsername}`, `https://${domain}`);

    const note = new Note({
      id: noteId,
      attribution: actorId,
      content: formatContent(entry),
      url: tryParseUrl(entry.link),
      published: entry.publishedAt
        ? Temporal.Instant.from(entry.publishedAt.toISOString())
        : undefined,
    });

    const create = new Create({
      id: new URL(`${noteId.href}#activity`),
      actor: actorId,
      object: note,
    });

    await ctx.sendActivity(
      { identifier: botUsername },
      "followers",
      create,
    );
    published++;
  }

  return { published, skipped };
}

function formatContent(entry: FeedEntry): string {
  if (entry.link) {
    return `<p>${escapeHtml(entry.title)}</p><p><a href="${escapeHtml(entry.link)}">${escapeHtml(entry.link)}</a></p>`;
  }
  return `<p>${escapeHtml(entry.title)}</p>`;
}

function tryParseUrl(link: string | undefined): URL | undefined {
  if (!link) return undefined;
  try {
    return new URL(link);
  } catch {
    return undefined;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
