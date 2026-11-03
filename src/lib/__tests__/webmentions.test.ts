import { describe, expect, it } from "vitest";
import { exclusionReason, findWebmentionEndpoint, webmentionTarget } from "../webmentions";

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
