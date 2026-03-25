import Parser from "rss-parser";

const parser = new Parser({
  timeout: 10_000,
  customFields: {
    item: ["media:keywords", ["dc:subject", "dcSubject"]],
  },
});

/** Max items to process per feed per poll; limits DoS from huge feeds. */
export const MAX_ITEMS_PER_POLL = 100;

export interface FeedEntry {
  guid: string;
  title: string;
  link: string;
  publishedAt: Date | null;
  /** Raw category/keyword strings from the feed item (RSS category, Atom term, dc:subject, etc.). */
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

function splitKeywordBlob(s: string): string[] {
  return s
    .split(/[,;|]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Collects human-readable category/tag strings from an rss-parser item.
 */
export function extractFeedCategories(item: Parser.Item): string[] {
  const raw = item as Record<string, unknown>;
  const out: string[] = [];

  const cats = raw.categories;
  if (Array.isArray(cats)) {
    for (const c of cats) {
      out.push(...flattenCategoryValue(c));
    }
  } else if (cats != null) {
    out.push(...flattenCategoryValue(cats));
  }

  const mediaKw = raw["media:keywords"];
  if (typeof mediaKw === "string") {
    out.push(...splitKeywordBlob(mediaKw));
  }

  const dc = raw.dcSubject;
  if (typeof dc === "string") {
    out.push(...splitKeywordBlob(dc));
  } else if (Array.isArray(dc)) {
    for (const x of dc) {
      if (typeof x === "string") {
        out.push(...splitKeywordBlob(x));
      } else {
        out.push(...flattenCategoryValue(x));
      }
    }
  }

  const itunes = raw.itunes as Record<string, unknown> | undefined;
  const ik = itunes?.keywords;
  if (Array.isArray(ik)) {
    for (const x of ik) {
      if (typeof x === "string") {
        out.push(...splitKeywordBlob(x));
      }
    }
  } else if (typeof ik === "string") {
    out.push(...splitKeywordBlob(ik));
  }

  return out;
}

function normalizeFeedItem(item: Parser.Item): FeedEntry {
  // rss-parser maps RSS <guid> to item.guid and Atom <id> to item.id
  const raw = item as Record<string, unknown>;
  const guid = item.guid || (raw.id as string | undefined) || item.link || item.title || "";
  const title = item.title || "(untitled)";
  const link = item.link || "";
  const publishedAt = item.isoDate ? new Date(item.isoDate) : null;
  const feedCategories = extractFeedCategories(item);
  return { guid, title, link, publishedAt, feedCategories };
}
