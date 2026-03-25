import { describe, it, expect, vi, afterEach } from "vitest";
import { coerceNoteHashtags, normalizeHashtagLabel, resolveHashtags } from "../hashtags";
import type { BotConfig } from "../config";
import type { FeedEntry } from "../rss";

const baseBot: BotConfig = {
  feed_url: "https://example.com/feed.xml",
  display_name: "Test",
  summary: "Short summary for hashtag context.",
};

function makeEntry(over: Partial<FeedEntry> & Pick<FeedEntry, "title">): FeedEntry {
  return {
    guid: "g",
    link: "",
    publishedAt: null,
    feedCategories: [],
    ...over,
  };
}

describe("coerceNoteHashtags", () => {
  it("derives tags from title/link when DB stored value is empty", () => {
    const tags = coerceNoteHashtags([], {
      botUsername: "my_bot",
      title: "Rust 1.85 released",
      link: "https://blog.rust-lang.org/",
    });
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.some((t) => /rust/i.test(t))).toBe(true);
  });

  it("returns empty when nothing is stored and nothing can be derived", () => {
    expect(
      coerceNoteHashtags([], {
        botUsername: "x",
        title: "a",
        link: "",
      }),
    ).toEqual([]);
  });

  it("keeps stored tags when present", () => {
    expect(
      coerceNoteHashtags(["A", "B", "C"], {
        botUsername: "x",
        title: "ignored",
        link: "",
      }),
    ).toEqual(["A", "B", "C"]);
  });
});

describe("normalizeHashtagLabel", () => {
  it("strips # and non-alphanumeric ASCII", () => {
    expect(normalizeHashtagLabel("  #Hello-World!  ")).toBe("HelloWorld");
  });

  it("returns null for empty after normalization", () => {
    expect(normalizeHashtagLabel("!!!")).toBeNull();
  });
});

describe("resolveHashtags", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("takes first three distinct feed categories", async () => {
    const tags = await resolveHashtags(
      makeEntry({
        title: "T",
        feedCategories: ["rust", "lang", "systems", "extra"],
      }),
      "my_bot",
      baseBot,
      {},
    );
    expect(tags).toEqual(["rust", "lang", "systems"]);
  });

  it("uses default_hashtags from bot config", async () => {
    const tags = await resolveHashtags(makeEntry({ title: "Hello world today" }), "nyt_world", {
      ...baseBot,
      default_hashtags: ["World", "News"],
    });
    expect(tags[0]).toBe("World");
    expect(tags[1]).toBe("News");
    expect(tags).toHaveLength(3);
  });

  it("derives tags from title (and hostname) without generic padding", async () => {
    const tags = await resolveHashtags(
      makeEntry({ title: "The quick brown fox", link: "https://example.com/x", feedCategories: [] }),
      "danluu",
      baseBot,
      {},
    );
    expect(tags).toContain("The");
    expect(tags).toContain("Quick");
    expect(tags).toContain("Brown");
  });

  it("can return only hostname when title yields no long words", async () => {
    const tags = await resolveHashtags(
      makeEntry({ title: "Hi", link: "https://www.theverge.com/2024/1/1", feedCategories: [] }),
      "x",
      baseBot,
      {},
    );
    expect(tags).toEqual(["Theverge"]);
  });
});
