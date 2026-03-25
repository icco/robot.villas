import Parser from "rss-parser";

const parser = new Parser({ timeout: 10_000 });

/** Max items to process per feed per poll; limits DoS from huge feeds. */
export const MAX_ITEMS_PER_POLL = 100;

export interface FeedEntry {
  guid: string;
  title: string;
  link: string;
  publishedAt: Date | null;
  /** Category strings from RSS `<category>` / Atom `<category term>`. */
  feedCategories: string[];
}

export async function fetchFeed(feedUrl: string): Promise<FeedEntry[]> {
  const feed = await parser.parseURL(feedUrl);
  const items = feed.items.map(normalizeFeedItem);
  return items.slice(0, MAX_ITEMS_PER_POLL);
}

export async function parseFeedXml(xml: string): Promise<FeedEntry[]> {
  const feed = await parser.parseString(xml);
  const items = feed.items.map(normalizeFeedItem);
  return items.slice(0, MAX_ITEMS_PER_POLL);
}

function flattenCategoryValue(c: unknown): string[] {
  if (c == null) {
    return [];
  }
  if (typeof c === "string") {
    const t = c.trim();
    return t ? [t] : [];
  }
  if (typeof c === "object") {
    const o = c as Record<string, unknown>;
    if (typeof o._ === "string" && o._.trim()) {
      return [o._.trim()];
    }
    if (typeof o.term === "string" && o.term.trim()) {
      return [o.term.trim()];
    }
  }
  return [];
}

/**
 * Collects category strings from `item.categories` only (RSS + Atom).
 */
export function extractFeedCategories(item: Parser.Item): string[] {
  const raw = item as Record<string, unknown>;
  const cats = raw.categories;
  const out: string[] = [];
  if (Array.isArray(cats)) {
    for (const c of cats) {
      out.push(...flattenCategoryValue(c));
    }
  } else if (cats != null) {
    out.push(...flattenCategoryValue(cats));
  }
  return out;
}

function normalizeFeedItem(item: Parser.Item): FeedEntry {
  const raw = item as Record<string, unknown>;
  const guid = item.guid || (raw.id as string | undefined) || item.link || item.title || "";
  const title = item.title || "(untitled)";
  const link = item.link || "";
  const publishedAt = item.isoDate ? new Date(item.isoDate) : null;
  return { guid, title, link, publishedAt, feedCategories: extractFeedCategories(item) };
}
