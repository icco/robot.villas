import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: vi.fn().mockRejectedValue(new Error("mock: no real API calls in tests")),
    };
  },
}));

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
  beforeEach(() => {
    // Ensure no Gemini env vars bleed in from the environment unless a test sets them.
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_PROJECT", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to feed categories when Gemini is not configured", async () => {
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

  it("falls back to default_hashtags when feed has no categories and Gemini is not configured", async () => {
    const tags = await resolveHashtags(makeEntry({ title: "Hello world today" }), "nyt_world", {
      ...baseBot,
      default_hashtags: ["World", "News"],
    });
    expect(tags).toEqual(["World", "News"]);
  });

  it("returns empty when no categories, defaults, or Gemini", async () => {
    const tags = await resolveHashtags(
      makeEntry({ title: "The quick brown fox", link: "https://example.com/x", feedCategories: [] }),
      "danluu",
      baseBot,
      { geminiApiKey: "" },
    );
    expect(tags).toEqual([]);
  });

  it("seeds pool from default_hashtags only (not categories) when Gemini is configured", async () => {
    // Gemini is "configured" but we expect it to fail; the pool should only contain defaults,
    // proving categories were not added directly.
    const tags = await resolveHashtags(
      makeEntry({
        title: "T",
        feedCategories: ["ShouldNotAppear", "AlsoNot"],
      }),
      "my_bot",
      { ...baseBot, default_hashtags: ["DefaultTag"] },
      { geminiApiKey: "fake-key-that-will-fail" },
    );
    // Gemini call will throw; we fall back to whatever is in the pool (defaults only).
    expect(tags).not.toContain("ShouldNotAppear");
    expect(tags).not.toContain("AlsoNot");
    expect(tags).toContain("DefaultTag");
  });
});
