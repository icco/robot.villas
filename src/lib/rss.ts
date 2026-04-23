import Parser from "rss-parser";

const parser = new Parser({ timeout: 10_000 });

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: "\u00A0", ndash: "\u2013", mdash: "\u2014",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D",
  hellip: "\u2026",
};

/**
 * Decodes HTML entities from a string in a single pass. Needed because
 * rss-parser returns raw CDATA content without decoding HTML entities
 * (e.g. &#8217; stays as-is). Without this, escapeHtml() double-encodes
 * the ampersand, causing Mastodon to display raw entity strings like &#8217;.
 */
export function decodeHtmlEntities(str: string): string {
  return str.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/gi, (match, dec, hex, name) => {
    if (dec) {
      return String.fromCodePoint(parseInt(dec, 10));
    }
    if (hex) {
      return String.fromCodePoint(parseInt(hex, 16));
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? match;
  });
}

/** Replaces Unicode typographic characters with plain ASCII equivalents. */
export function normalizeTypography(str: string): string {
  return str
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")  // curly single quotes, apostrophes, primes
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')  // curly double quotes, double primes
    .replace(/\u2013/g, "-")                                   // en dash
    .replace(/\u2014/g, "--")                                  // em dash
    .replace(/\u2026/g, "...")                                 // ellipsis
    .replace(/\u00A0/g, " ");                                  // non-breaking space
}

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
  const title = normalizeTypography(decodeHtmlEntities(item.title || "(untitled)"));
  const link = item.link || "";
  const publishedAt = item.isoDate ? new Date(item.isoDate) : null;
  return { guid, title, link, publishedAt, feedCategories: extractFeedCategories(item) };
}
