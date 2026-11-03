import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryKvStore } from "@fedify/fedify";
import {
  discoverWebmentionEndpoint, exclusionReason, findWebmentionEndpoint, sendWebmention, webmentionTarget,
} from "../webmentions";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function respond(body: string, init: ResponseInit & { url?: string } = {}): Response {
  const response = new Response(body, init);
  if (init.url) {
    Object.defineProperty(response, "url", { value: init.url });
  }
  return response;
}

const page = new URL("https://ada.example/posts/1");

describe("findWebmentionEndpoint", () => {
  it("prefers the Link header over HTML", () => {
    const html = `<link rel="webmention" href="/from-html">`;
    expect(findWebmentionEndpoint(`</from-header>; rel="webmention"`, html, page)?.href)
      .toBe("https://ada.example/from-header");
  });

  it("matches one token of a multi-valued rel in the Link header", () => {
    expect(findWebmentionEndpoint(`<https://wm.example/e>; rel="webmention somethingelse"`, null, page)?.href)
      .toBe("https://wm.example/e");
  });

  it("ignores rels that only contain the word", () => {
    expect(findWebmentionEndpoint(`</nope>; rel="not-webmention"`, `<a rel="webmentions" href="/nope">x</a>`, page))
      .toBeNull();
  });

  it("takes the first link or a element in document order", () => {
    const html = `<body><a rel="webmention" href="/first">x</a><link rel="webmention" href="/second"></body>`;
    expect(findWebmentionEndpoint(null, html, page)?.href).toBe("https://ada.example/first");
  });

  it("matches multi-valued and mixed-case rel attributes", () => {
    expect(findWebmentionEndpoint(null, `<link rel="nofollow WebMention" href="https://wm.example/e">`, page)?.href)
      .toBe("https://wm.example/e");
  });

  it("skips elements without an href", () => {
    const html = `<link rel="webmention"><link rel="webmention" href="/real">`;
    expect(findWebmentionEndpoint(null, html, page)?.href).toBe("https://ada.example/real");
  });

  it("treats an empty href as the page itself", () => {
    expect(findWebmentionEndpoint(null, `<link rel="webmention" href="">`, page)?.href).toBe(page.href);
  });

  it("ignores endpoints inside HTML comments", () => {
    const html = `<!-- <link rel="webmention" href="/commented"> --><link rel="webmention" href="/live">`;
    expect(findWebmentionEndpoint(null, html, page)?.href).toBe("https://ada.example/live");
  });

  it("resolves relative endpoints against the page and keeps their query string", () => {
    const after = new URL("https://ada.example/2026/post/");
    expect(findWebmentionEndpoint(null, `<link rel="webmention" href="wm?version=1">`, after)?.href)
      .toBe("https://ada.example/2026/post/wm?version=1");
  });

  it("rejects non-HTTP endpoints", () => {
    expect(findWebmentionEndpoint(`<mailto:ada@ada.example>; rel="webmention"`, null, page)).toBeNull();
  });

  it("returns null when nothing is advertised", () => {
    expect(findWebmentionEndpoint(null, `<html><body>hi</body></html>`, page)).toBeNull();
  });
});

describe("webmentionTarget", () => {
  it("drops utm parameters and the fragment but keeps other query parameters", () => {
    expect(webmentionTarget(new URL("https://ada.example/p?id=7&utm_source=rss&UTM_Medium=feed#comments")).href)
      .toBe("https://ada.example/p?id=7");
  });

  it("leaves clean URLs alone", () => {
    expect(webmentionTarget(new URL("https://writing.natwelch.com/post/780")).href)
      .toBe("https://writing.natwelch.com/post/780");
  });
});

describe("exclusionReason", () => {
  const person = { automated: false, summary: "<p>Writes about engines</p>", discoverable: true, hashtags: [] };

  it("allows ordinary people", () => {
    expect(exclusionReason(person)).toBeNull();
  });

  it("excludes automated accounts", () => {
    expect(exclusionReason({ ...person, automated: true })).toBe("automated");
  });

  it("excludes #nobridge and #nobot in a linkified bio", () => {
    expect(exclusionReason({ ...person, summary: `<p>Hi <a href="https://m.example/tags/nobridge" class="mention hashtag" rel="tag">#<span>NoBridge</span></a></p>` }))
      .toBe("nobridge");
    expect(exclusionReason({ ...person, summary: "<p>#nobot please</p>" })).toBe("nobot");
  });

  it("excludes opt-out hashtags listed as actor tags", () => {
    expect(exclusionReason({ ...person, hashtags: ["#NoBot"] })).toBe("nobot");
  });

  it("does not match longer hashtags", () => {
    expect(exclusionReason({ ...person, summary: "<p>#nobridgefan #nobots</p>" })).toBeNull();
  });

  it("excludes undiscoverable accounts but not ones that never said", () => {
    expect(exclusionReason({ ...person, discoverable: false })).toBe("undiscoverable");
    expect(exclusionReason({ ...person, discoverable: null })).toBeNull();
  });
});

describe("discoverWebmentionEndpoint", () => {
  it("targets the final URL without tracking parameters and caches the result", async () => {
    const fetch = vi.fn(async () => respond(`<link rel="webmention" href="/wm">`, {
      headers: { "content-type": "text/html; charset=utf-8" },
      url: "https://ada.example/posts/1?utm_source=rss",
    }));
    globalThis.fetch = fetch as typeof globalThis.fetch;
    const kv = new MemoryKvStore();
    const expected = { endpoint: "https://ada.example/wm", target: "https://ada.example/posts/1" };
    expect(await discoverWebmentionEndpoint(kv, "https://ada.example/p/1?utm_medium=feed")).toEqual(expected);
    expect(await discoverWebmentionEndpoint(kv, "https://ada.example/p/1")).toEqual(expected);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("skips the rest of a host whose article has no endpoint", async () => {
    const fetch = vi.fn(async () => respond("<p>no endpoint</p>", { headers: { "content-type": "text/html" } }));
    globalThis.fetch = fetch as typeof globalThis.fetch;
    const kv = new MemoryKvStore();
    expect(await discoverWebmentionEndpoint(kv, "https://bob.example/one")).toBeNull();
    expect(await discoverWebmentionEndpoint(kv, "https://bob.example/two")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws on server errors so the task retries, without caching", async () => {
    const fetch = vi.fn(async () => respond("down", { status: 503 }));
    globalThis.fetch = fetch as typeof globalThis.fetch;
    const kv = new MemoryKvStore();
    await expect(discoverWebmentionEndpoint(kv, "https://ada.example/p/2")).rejects.toThrow("HTTP 503");
    await expect(discoverWebmentionEndpoint(kv, "https://ada.example/p/2")).rejects.toThrow("HTTP 503");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never fetches non-HTTP article URLs", async () => {
    const fetch = vi.fn();
    globalThis.fetch = fetch as typeof globalThis.fetch;
    expect(await discoverWebmentionEndpoint(new MemoryKvStore(), "javascript:alert(1)")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("sendWebmention", () => {
  it("posts form-encoded source and target", async () => {
    const fetch = vi.fn(async (_url: URL, _init: RequestInit) => respond("", { status: 202 }));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    expect(await sendWebmention("https://wm.example/e", "https://robot.test/s", "https://ada.example/t")).toBe(true);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://wm.example/e");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      source: "https://robot.test/s", target: "https://ada.example/t",
    });
  });

  it("drops refusals and throws on errors worth retrying", async () => {
    globalThis.fetch = vi.fn(async () => respond("", { status: 400 })) as unknown as typeof globalThis.fetch;
    expect(await sendWebmention("https://wm.example/e", "https://robot.test/s", "https://ada.example/t")).toBe(false);
    for (const status of [408, 429, 500]) {
      globalThis.fetch = vi.fn(async () => respond("", { status })) as unknown as typeof globalThis.fetch;
      await expect(sendWebmention("https://wm.example/e", "https://robot.test/s", "https://ada.example/t")).rejects.toThrow(`HTTP ${status}`);
    }
  });

  it("refuses endpoints on private addresses", async () => {
    globalThis.fetch = vi.fn() as unknown as typeof globalThis.fetch;
    await expect(sendWebmention("http://127.0.0.1/e", "https://robot.test/s", "https://ada.example/t")).rejects.toThrow("not public");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
