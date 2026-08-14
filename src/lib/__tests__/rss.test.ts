import { afterEach, describe, expect, it } from "vitest";
import {
  decodeHtmlEntities,
  DEFAULT_RATE_LIMIT_BACKOFF_MS,
  extractFeedCategories,
  FEED_USER_AGENT,
  fetchFeedWithHttpResult,
  MAX_ITEMS_PER_POLL,
  MAX_RATE_LIMIT_BACKOFF_MS,
  normalizeTypography,
  parseFeedXml,
  parseRetryAfterMs,
  toFeedText,
  type FeedEntry,
} from "../rss";
import type { Item } from "rss-parser";

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    <description>A test feed</description>
    <item>
      <title>First Post</title>
      <link>https://example.com/first</link>
      <guid>guid-1</guid>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Second Post</title>
      <link>https://example.com/second</link>
      <guid>guid-2</guid>
      <pubDate>Tue, 02 Jan 2024 12:00:00 GMT</pubDate>
      <category>Tech</category>
      <category>News</category>
    </item>
  </channel>
</rss>`;

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <link href="https://example.com"/>
  <entry>
    <title>Atom Entry</title>
    <link href="https://example.com/atom-entry"/>
    <id>urn:uuid:atom-1</id>
    <updated>2024-01-15T10:00:00Z</updated>
  </entry>
</feed>`;

const MINIMAL_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Minimal</title>
    <item>
      <title>No link or guid</title>
    </item>
  </channel>
</rss>`;

describe("parseFeedXml", () => {
  it("parses RSS 2.0 items", async () => {
    const entries = await parseFeedXml(SAMPLE_RSS);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      guid: "guid-1",
      title: "First Post",
      link: "https://example.com/first",
      feedCategories: [],
    });
    expect(entries[0].publishedAt).toBeInstanceOf(Date);
    expect(entries[1].guid).toBe("guid-2");
    expect(entries[1].feedCategories).toEqual(["Tech", "News"]);
  });

  it("parses Atom feeds", async () => {
    const entries = await parseFeedXml(ATOM_FEED);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      guid: "urn:uuid:atom-1",
      title: "Atom Entry",
      link: "https://example.com/atom-entry",
      feedCategories: [],
    });
    expect(entries[0].publishedAt).toBeInstanceOf(Date);
  });

  it("handles items with missing fields gracefully", async () => {
    const entries = await parseFeedXml(MINIMAL_RSS);
    expect(entries).toHaveLength(1);
    const entry = entries[0] as FeedEntry;
    expect(entry.title).toBe("No link or guid");
    expect(entry.guid).toBe("No link or guid");
    expect(entry.link).toBe("");
    expect(entry.publishedAt).toBeNull();
    expect(entry.feedCategories).toEqual([]);
  });

  it("collects only item.categories via extractFeedCategories", () => {
    const item = {
      categories: ["A", { _: "B" }, { term: "C" }],
    } as Item;
    expect(extractFeedCategories(item).sort()).toEqual(["A", "B", "C"].sort());
  });

  it("returns empty array for empty feed", async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>Empty</title></channel></rss>`;
    const entries = await parseFeedXml(xml);
    expect(entries).toEqual([]);
  });

  it("caps items at MAX_ITEMS_PER_POLL", async () => {
    const item = (i: number) =>
      `<item><title>Item ${i}</title><link>https://example.com/${i}</link><guid>g-${i}</guid></item>`;
    const many = Array.from({ length: MAX_ITEMS_PER_POLL + 10 }, (_, i) => item(i)).join("");
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Big</title>${many}</channel></rss>`;
    const entries = await parseFeedXml(xml);
    expect(entries).toHaveLength(MAX_ITEMS_PER_POLL);
    expect(entries[0]?.title).toBe("Item 0");
    expect(entries[MAX_ITEMS_PER_POLL - 1]?.title).toBe(`Item ${MAX_ITEMS_PER_POLL - 1}`);
  });

  it("decodes HTML entities in CDATA titles and normalizes to ASCII", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test</title>
    <item>
      <title><![CDATA[Ikea&#8217;s new inflatable chair doesn&#8217;t look like an inflatable chair]]></title>
      <link>https://example.com/ikea</link>
      <guid>ikea-1</guid>
    </item>
  </channel>
</rss>`;
    const entries = await parseFeedXml(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe("Ikea's new inflatable chair doesn't look like an inflatable chair");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes decimal numeric character references", () => {
    expect(decodeHtmlEntities("Ikea&#8217;s")).toBe("Ikea\u2019s");
    expect(decodeHtmlEntities("&#169; 2024")).toBe("\u00A9 2024");
  });

  it("decodes hex numeric character references", () => {
    expect(decodeHtmlEntities("&#x2019;s")).toBe("\u2019s");
    expect(decodeHtmlEntities("&#X2019;s")).toBe("\u2019s");
  });

  it("decodes common named entities", () => {
    expect(decodeHtmlEntities("AT&amp;T")).toBe("AT&T");
    expect(decodeHtmlEntities("&lt;b&gt;")).toBe("<b>");
    expect(decodeHtmlEntities("&quot;quoted&quot;")).toBe('"quoted"');
    expect(decodeHtmlEntities("&apos;")).toBe("'");
    expect(decodeHtmlEntities("foo&nbsp;bar")).toBe("foo\u00A0bar");
    expect(decodeHtmlEntities("&mdash;")).toBe("\u2014");
    expect(decodeHtmlEntities("&hellip;")).toBe("\u2026");
  });

  it("decodes &amp; as a single pass (does not double-decode)", () => {
    // Single pass: &amp;#8217; → &#8217; (the &amp; is decoded to &, but the
    // resulting &#8217; is not processed again in the same call)
    expect(decodeHtmlEntities("&amp;#8217;")).toBe("&#8217;");
  });

  it("passes through plain text unchanged", () => {
    expect(decodeHtmlEntities("Hello world")).toBe("Hello world");
    expect(decodeHtmlEntities("")).toBe("");
  });
});

describe("normalizeTypography", () => {
  it("replaces curly single quotes and apostrophes with ASCII apostrophe", () => {
    expect(normalizeTypography("\u2018hello\u2019")).toBe("'hello'");
    expect(normalizeTypography("Ikea\u2019s")).toBe("Ikea's");
  });

  it("replaces curly double quotes with ASCII double quote", () => {
    expect(normalizeTypography("\u201Chello\u201D")).toBe('"hello"');
  });

  it("replaces en dash with hyphen", () => {
    expect(normalizeTypography("2020\u20132021")).toBe("2020-2021");
  });

  it("replaces em dash with double hyphen", () => {
    expect(normalizeTypography("foo\u2014bar")).toBe("foo--bar");
  });

  it("replaces ellipsis with three dots", () => {
    expect(normalizeTypography("wait\u2026")).toBe("wait...");
  });

  it("replaces non-breaking space with regular space", () => {
    expect(normalizeTypography("foo\u00A0bar")).toBe("foo bar");
  });

  it("passes through plain ASCII unchanged", () => {
    expect(normalizeTypography("Hello, world!")).toBe("Hello, world!");
    expect(normalizeTypography("")).toBe("");
  });
});

describe("fetchFeedWithHttpResult", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns HTTP status and no entries on non-OK responses", async () => {
    globalThis.fetch = async () => new Response("", { status: 503 });
    const r = await fetchFeedWithHttpResult("https://example.com/feed.xml");
    expect(r.httpStatus).toBe(503);
    expect(r.errorMessage).toMatch(/503/);
    expect(r.entries).toEqual([]);
  });

  it("parses entries on successful responses", async () => {
    globalThis.fetch = async () =>
      new Response(SAMPLE_RSS, { status: 200, headers: { "Content-Type": "application/rss+xml" } });
    const r = await fetchFeedWithHttpResult("https://example.com/feed.xml");
    expect(r.httpStatus).toBe(200);
    expect(r.errorMessage).toBeNull();
    expect(r.entries.length).toBe(2);
    expect(r.notModified).toBe(false);
  });

  it("sends an identifying User-Agent", async () => {
    let seen: Headers | undefined;
    globalThis.fetch = async (_url, init) => {
      seen = new Headers(init?.headers);
      return new Response(SAMPLE_RSS, { status: 200 });
    };
    await fetchFeedWithHttpResult("https://example.com/feed.xml");
    expect(seen?.get("user-agent")).toBe(FEED_USER_AGENT);
    expect(seen?.get("user-agent")).toMatch(/robot\.villas/);
  });

  it("sends stored validators as conditional GET headers", async () => {
    let seen: Headers | undefined;
    globalThis.fetch = async (_url, init) => {
      seen = new Headers(init?.headers);
      return new Response(SAMPLE_RSS, { status: 200 });
    };
    await fetchFeedWithHttpResult("https://example.com/feed.xml", {
      etag: '"abc"',
      lastModified: "Wed, 21 Oct 2015 07:28:00 GMT",
    });
    expect(seen?.get("if-none-match")).toBe('"abc"');
    expect(seen?.get("if-modified-since")).toBe("Wed, 21 Oct 2015 07:28:00 GMT");
  });

  it("omits conditional headers when nothing is cached", async () => {
    let seen: Headers | undefined;
    globalThis.fetch = async (_url, init) => {
      seen = new Headers(init?.headers);
      return new Response(SAMPLE_RSS, { status: 200 });
    };
    await fetchFeedWithHttpResult("https://example.com/feed.xml");
    expect(seen?.has("if-none-match")).toBe(false);
    expect(seen?.has("if-modified-since")).toBe(false);
  });

  it("returns validators from a 200 so the next request can be conditional", async () => {
    globalThis.fetch = async () =>
      new Response(SAMPLE_RSS, {
        status: 200,
        headers: { ETag: '"v2"', "Last-Modified": "Wed, 21 Oct 2015 07:28:00 GMT" },
      });
    const r = await fetchFeedWithHttpResult("https://example.com/feed.xml");
    expect(r.validators).toEqual({
      etag: '"v2"',
      lastModified: "Wed, 21 Oct 2015 07:28:00 GMT",
    });
  });

  it("treats 304 as success with no entries", async () => {
    globalThis.fetch = async () => new Response(null, { status: 304 });
    const r = await fetchFeedWithHttpResult("https://example.com/feed.xml", {
      etag: '"abc"',
      lastModified: null,
    });
    expect(r.httpStatus).toBe(304);
    expect(r.errorMessage).toBeNull();
    expect(r.notModified).toBe(true);
    expect(r.entries).toEqual([]);
  });

  it("keeps the cached validators when a 304 repeats none of them", async () => {
    globalThis.fetch = async () => new Response(null, { status: 304 });
    const r = await fetchFeedWithHttpResult("https://example.com/feed.xml", {
      etag: '"abc"',
      lastModified: "Wed, 21 Oct 2015 07:28:00 GMT",
    });
    expect(r.validators).toEqual({
      etag: '"abc"',
      lastModified: "Wed, 21 Oct 2015 07:28:00 GMT",
    });
  });

  it("does not return validators for an unparseable body, so the body is retried", async () => {
    globalThis.fetch = async () =>
      new Response("this is not xml at all", { status: 200, headers: { ETag: '"v2"' } });
    const r = await fetchFeedWithHttpResult("https://example.com/feed.xml");
    expect(r.errorMessage).not.toBeNull();
    expect(r.validators).toBeNull();
  });

  it("does not return validators for an error response", async () => {
    globalThis.fetch = async () => new Response("", { status: 500, headers: { ETag: '"v2"' } });
    const r = await fetchFeedWithHttpResult("https://example.com/feed.xml");
    expect(r.validators).toBeNull();
    expect(r.retryAfterMs).toBeNull();
  });

  it("honours Retry-After on a 429", async () => {
    globalThis.fetch = async () =>
      new Response("", { status: 429, headers: { "Retry-After": "120" } });
    const r = await fetchFeedWithHttpResult("https://example.com/feed.xml");
    expect(r.httpStatus).toBe(429);
    expect(r.errorMessage).toMatch(/429/);
    expect(r.retryAfterMs).toBe(120_000);
  });

  it("falls back to a default backoff when a 429 carries no Retry-After", async () => {
    globalThis.fetch = async () => new Response("", { status: 429 });
    const r = await fetchFeedWithHttpResult("https://example.com/feed.xml");
    expect(r.retryAfterMs).toBe(DEFAULT_RATE_LIMIT_BACKOFF_MS);
  });
});

describe("parseRetryAfterMs", () => {
  const NOW = Date.parse("2026-08-14T21:00:00Z");

  it("parses delta-seconds", () => {
    expect(parseRetryAfterMs("30", NOW)).toBe(30_000);
  });

  it("parses an HTTP-date", () => {
    expect(parseRetryAfterMs("Fri, 14 Aug 2026 21:05:00 GMT", NOW)).toBe(300_000);
  });

  it("clamps a past HTTP-date to zero", () => {
    expect(parseRetryAfterMs("Fri, 14 Aug 2026 20:00:00 GMT", NOW)).toBe(0);
  });

  it("clamps an absurd delay to the maximum", () => {
    expect(parseRetryAfterMs("99999999", NOW)).toBe(MAX_RATE_LIMIT_BACKOFF_MS);
  });

  it("returns null for a missing or unparseable value", () => {
    expect(parseRetryAfterMs(null, NOW)).toBeNull();
    expect(parseRetryAfterMs("soon", NOW)).toBeNull();
  });
});

describe("toFeedText", () => {
  it("passes strings through", () => {
    expect(toFeedText("hello")).toBe("hello");
  });

  it("unwraps the text node of an attributed tag", () => {
    expect(toFeedText({ _: "hello", $: { isPermaLink: "false" } })).toBe("hello");
  });

  it("returns an empty string for an attributes-only tag", () => {
    // `<guid isPermaLink="false"></guid>`, as seen on undark.org, parses to this shape.
    expect(toFeedText({ $: { isPermaLink: "false" } })).toBe("");
  });

  it("returns an empty string for missing values", () => {
    expect(toFeedText(undefined)).toBe("");
    expect(toFeedText(null)).toBe("");
  });
});

describe("parseFeedXml with an attributes-only guid", () => {
  const RSS_WITH_EMPTY_GUID = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Broken Guid Feed</title>
    <link>https://example.com</link>
    <description>Feed whose guid tag carries only attributes</description>
    <item>
      <title>A Post</title>
      <link>https://example.com/a-post</link>
      <guid isPermaLink="false"></guid>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

  it("falls back to the link instead of yielding a non-string guid", async () => {
    const entries = await parseFeedXml(RSS_WITH_EMPTY_GUID);
    expect(entries).toHaveLength(1);
    expect(typeof entries[0].guid).toBe("string");
    expect(entries[0].guid).toBe("https://example.com/a-post");
    expect(entries[0].title).toBe("A Post");
  });
});
