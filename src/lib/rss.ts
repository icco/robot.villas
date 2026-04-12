import Parser from "rss-parser";

const parser = new Parser({ timeout: 10_000 });

const FEED_FETCH_TIMEOUT_MS = 10_000;

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

export interface FeedFetchResult {
  entries: FeedEntry[];
  /** HTTP status when a response was received; null on errors before a response (e.g. timeout). */
  httpStatus: number | null;
  /** Null when the feed was fetched with a 2xx/3xx response and parsed successfully. */
  errorMessage: string | null;
}

/**
 * Fetches a feed over HTTP, records status for observability, and parses the body when the response is OK.
 */
export async function fetchFeedWithHttpResult(feedUrl: string): Promise<FeedFetchResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(feedUrl, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
          "User-Agent": "robot.villas RSS poller",
        },
      });
      const httpStatus = res.status;
      if (!res.ok) {
        return { entries: [], httpStatus, errorMessage: `HTTP ${httpStatus}` };
      }
      const text = await res.text();
      try {
        const entries = await parseFeedXml(text);
        return { entries, httpStatus, errorMessage: null };
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        return { entries: [], httpStatus, errorMessage: msg };
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { entries: [], httpStatus: null, errorMessage: msg };
  }
}

export async function fetchFeed(feedUrl: string): Promise<FeedEntry[]> {
  const { entries, errorMessage } = await fetchFeedWithHttpResult(feedUrl);
  if (errorMessage) {
    throw new Error(errorMessage);
  }
  return entries;
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
