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
  it("normalizes and dedupes raw strings only", () => {
    expect(mergeHashtagCandidates(["Tech", "#tech", "News"], 3)).toEqual(["Tech", "News"]);
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

  it("uses only default_hashtags when feed has no categories", async () => {
    const tags = await resolveHashtags(makeEntry({ title: "Hello world today" }), "nyt_world", {
      ...baseBot,
      default_hashtags: ["World", "News"],
    });
    expect(tags).toEqual(["World", "News"]);
  });

  it("returns empty when no categories, defaults, or Gemini", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const tags = await resolveHashtags(
      makeEntry({ title: "The quick brown fox", link: "https://example.com/x", feedCategories: [] }),
      "danluu",
      baseBot,
      { geminiApiKey: "" },
    );
    expect(tags).toEqual([]);
  });
});
