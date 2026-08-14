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

/** Identifies the fetcher so feed hosts can contact us instead of blocking an anonymous bot. */
export const FEED_USER_AGENT = "robot.villas RSS poller/1.0 (+https://robot.villas/about)";

/** Backoff used when a 429 arrives without a usable `Retry-After`. */
export const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000;

/** Ceiling on server-requested backoff, so a bogus `Retry-After` can't park a feed forever. */
export const MAX_RATE_LIMIT_BACKOFF_MS = 24 * 60 * 60 * 1000;

export interface FeedEntry {
  guid: string;
  title: string;
  link: string;
  publishedAt: Date | null;
  /** Category strings from RSS `<category>` / Atom `<category term>`. */
  feedCategories: string[];
}

/** Cached HTTP validators for conditional GET, as last seen on a 200 or 304. */
export interface ConditionalGetState {
  etag: string | null;
  lastModified: string | null;
}

export interface FeedFetchResult {
  entries: FeedEntry[];
  /** HTTP status when a response was received; null on errors before a response (e.g. timeout). */
  httpStatus: number | null;
  /** Null when the feed was fetched with a 2xx/304 response and parsed successfully. */
  errorMessage: string | null;
  /** True on 304: unchanged since `validators`, so there is nothing to publish. */
  notModified: boolean;
  /**
   * Validators to persist. Null means "keep the stored ones" — caching validators from an
   * unparseable body would 304 forever and never retry it.
   */
  validators: ConditionalGetState | null;
  /** How long the server asked us to wait (429); null when not rate limited. */
  retryAfterMs: number | null;
}

/** Parses `Retry-After` (delta-seconds or HTTP-date) to ms, clamped; null when unusable. */
export function parseRetryAfterMs(value: string | null, now: number = Date.now()): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  let ms: number;
  if (/^\d+$/.test(trimmed)) {
    ms = Number(trimmed) * 1000;
  } else {
    const at = Date.parse(trimmed);
    if (Number.isNaN(at)) {
      return null;
    }
    ms = at - now;
  }
  return Math.min(Math.max(ms, 0), MAX_RATE_LIMIT_BACKOFF_MS);
}

/**
 * Fetches a feed with a conditional GET, records status for observability, and parses
 * the body when the response carries one.
 */
export async function fetchFeedWithHttpResult(
  feedUrl: string,
  cached: ConditionalGetState = { etag: null, lastModified: null },
): Promise<FeedFetchResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "User-Agent": FEED_USER_AGENT,
      };
      if (cached.etag) {
        headers["If-None-Match"] = cached.etag;
      }
      if (cached.lastModified) {
        headers["If-Modified-Since"] = cached.lastModified;
      }
      const res = await fetch(feedUrl, {
        signal: controller.signal,
        redirect: "follow",
        headers,
      });
      const httpStatus = res.status;
      if (httpStatus === 304) {
        // A 304 may repeat or omit the validators we sent.
        return {
          entries: [],
          httpStatus,
          errorMessage: null,
          notModified: true,
          validators: {
            etag: res.headers.get("etag") ?? cached.etag,
            lastModified: res.headers.get("last-modified") ?? cached.lastModified,
          },
          retryAfterMs: null,
        };
      }
      if (!res.ok) {
        const retryAfterMs =
          httpStatus === 429
            ? (parseRetryAfterMs(res.headers.get("retry-after")) ?? DEFAULT_RATE_LIMIT_BACKOFF_MS)
            : null;
        return {
          entries: [],
          httpStatus,
          errorMessage: `HTTP ${httpStatus}`,
          notModified: false,
          validators: null,
          retryAfterMs,
        };
      }
      const text = await res.text();
      try {
        const entries = await parseFeedXml(text);
        return {
          entries,
          httpStatus,
          errorMessage: null,
          notModified: false,
          validators: {
            etag: res.headers.get("etag"),
            lastModified: res.headers.get("last-modified"),
          },
          retryAfterMs: null,
        };
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        return {
          entries: [],
          httpStatus,
          errorMessage: msg,
          notModified: false,
          validators: null,
          retryAfterMs: null,
        };
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      entries: [],
      httpStatus: null,
      errorMessage: msg,
      notModified: false,
      validators: null,
      retryAfterMs: null,
    };
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

/**
 * Coerces a parsed feed field to a string. rss-parser returns an object for a tag with
 * attributes but no text — `<guid isPermaLink="false"></guid>` becomes
 * `{ $: { isPermaLink: "false" } }` — which is truthy and crashes string callers.
 */
export function toFeedText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o._ === "string") {
      return o._;
    }
    if (typeof o.href === "string") {
      return o.href;
    }
  }
  return "";
}

function normalizeFeedItem(item: Parser.Item): FeedEntry {
  const raw = item as Record<string, unknown>;
  const itemTitle = toFeedText(item.title);
  const itemLink = toFeedText(item.link);
  const guid = toFeedText(item.guid) || toFeedText(raw.id) || itemLink || itemTitle || "";
  const title = normalizeTypography(decodeHtmlEntities(itemTitle || "(untitled)"));
  const link = itemLink;
  const publishedAt = item.isoDate ? new Date(item.isoDate) : null;
  return { guid, title, link, publishedAt, feedCategories: extractFeedCategories(item) };
}
