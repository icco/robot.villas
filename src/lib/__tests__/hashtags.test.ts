import { describe, it, expect, vi, afterEach } from "vitest";
import {
  hashtagsForNoteBody,
  mergeHashtagCandidates,
  normalizeHashtagLabel,
  resolveHashtags,
} from "../hashtags";
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

describe("hashtagsForNoteBody", () => {
  it("returns empty for legacy empty storage", () => {
    expect(hashtagsForNoteBody([])).toEqual([]);
  });

  it("normalizes and dedupes stored tags", () => {
    expect(hashtagsForNoteBody(["#A", "a", "B"])).toEqual(["A", "B"]);
  });
});

describe("mergeHashtagCandidates", () => {
  it("merges raw strings then title words", () => {
    const tags = mergeHashtagCandidates(["Tech"], "The quick brown", "", 3);
    expect(tags).toContain("Tech");
    expect(tags).toContain("The");
    expect(tags).toContain("Quick");
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
