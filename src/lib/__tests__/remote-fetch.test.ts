import { afterEach, describe, expect, it } from "vitest";
import { assertRemoteUrl, fetchRemote, isPublicAddress, publicLookup, readLimitedText } from "../remote-fetch";
import { fetchFeedWithHttpResult, parseFeedXml, decodeHtmlEntities, MAX_FEED_BYTES } from "../rss";
import { partitionBlockedRecipients } from "../blocklist";
import { safeParseUrl } from "../urls";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const signal = () => AbortSignal.timeout(5_000);

describe("remote destination policy", () => {
  it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "fc00::1", "::ffff:127.0.0.1", "0.0.0.0"])(
    "rejects non-public address %s",
    (address) => expect(isPublicAddress(address)).toBe(false),
  );

  it("accepts public addresses", () => {
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it.each(["http://127.0.0.1/feed", "http://[::1]/", "http://localhost/", "http://a.localhost/", "ftp://example.com/", "https://u:p@example.com/"])(
    "rejects %s before connecting",
    (url) => expect(() => assertRemoteUrl(url)).toThrow(),
  );

  it("rejects hostnames that resolve to private addresses at connection time", async () => {
    const error = await new Promise<Error | null>((resolve) => {
      publicLookup("localhost", {}, (err) => resolve(err));
    });
    expect(error?.message).toMatch(/non-public/);
  });

  it("re-validates every redirect hop and drops validators across origins", async () => {
    const seen: Array<[string, Headers]> = [];
    globalThis.fetch = async (url, init) => {
      seen.push([String(url), new Headers(init?.headers)]);
      return seen.length === 1
        ? new Response(null, { status: 302, headers: { location: "https://other.example/feed" } })
        : new Response("ok");
    };
    const res = await fetchRemote("https://example.com/feed", { signal: signal(), headers: { "If-None-Match": '"x"' } });
    expect(await res.text()).toBe("ok");
    expect(seen[1][0]).toBe("https://other.example/feed");
    expect(seen[1][1].has("if-none-match")).toBe(false);

    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    await expect(fetchRemote("https://example.com/feed", { signal: signal() })).rejects.toThrow(/not public/);
  });

  it("stops redirect loops", async () => {
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "/again" } });
    await expect(fetchRemote("https://example.com/", { signal: signal() })).rejects.toThrow(/redirect/);
  });
});

describe("bounded feed reading", () => {
  it("rejects bodies over the byte limit by declared length and by streamed size", async () => {
    await expect(readLimitedText(new Response("x", { headers: { "content-length": "100" } }), 10)).rejects.toThrow(/limit/);
    await expect(readLimitedText(new Response("x".repeat(11)), 10)).rejects.toThrow(/limit/);
    expect(await readLimitedText(new Response("x".repeat(10)), 10)).toHaveLength(10);
  });

  it("reports an oversized feed as a poll error without caching validators", async () => {
    globalThis.fetch = async () => new Response("x".repeat(MAX_FEED_BYTES + 1), { headers: { ETag: '"v"' } });
    const result = await fetchFeedWithHttpResult("https://example.com/feed.xml");
    expect(result.errorMessage).toMatch(/limit/);
    expect(result.validators).toBeNull();
  });

  it("rejects DTD entity expansion and excessive nesting", async () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><rss><channel><item><title>&b;</title></item></channel></rss>`;
    await expect(parseFeedXml(bomb)).rejects.toThrow(/DTD/);
    await expect(parseFeedXml(`<rss>${"<x>".repeat(100)}${"</x>".repeat(100)}</rss>`)).rejects.toThrow(/complexity/);
  });

  it("keeps a feed usable when an item has invalid entities or dates", async () => {
    const entries = await parseFeedXml(`<rss version="2.0"><channel><title>t</title><item><title>bad &amp;#99999999; ok</title><link>https://example.com/a</link><pubDate>not a date</pubDate></item></channel></rss>`);
    expect(entries[0].publishedAt).toBeNull();
    expect(decodeHtmlEntities("&#99999999;&#xD800;&#65;")).toBe("\uFFFD\uFFFDA");
  });
});

describe("shared URL and block policy", () => {
  it("rejects scriptable and credentialed links for rendering", () => {
    expect(safeParseUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeParseUrl("https://user:pass@example.com")).toBeUndefined();
    expect(safeParseUrl("https://example.com/post")?.href).toBe("https://example.com/post");
  });

  it("blocks recipients by actor host as well as inbox host", () => {
    const result = partitionBlockedRecipients([
      { id: new URL("https://bad.example/actor"), inboxId: new URL("https://relay.example/inbox") },
      { id: new URL("https://good.example/actor"), inboxId: new URL("https://good.example/inbox") },
    ], new Set(["bad.example"]));
    expect(result.allowed.map((r) => r.id.hostname)).toEqual(["good.example"]);
  });
});
