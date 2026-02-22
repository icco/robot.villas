import { describe, it, expect, afterEach } from "vitest";
import { getBlockedInstances, parseConfig, loadConfig } from "../config.js";
import { join } from "node:path";

describe("parseConfig", () => {
  it("parses a valid config", () => {
    const config = parseConfig(`
bots:
  hackernews:
    feed_url: "https://news.ycombinator.com/rss"
    display_name: "Hacker News"
    summary: "Top stories from Hacker News"
`);
    expect(config.bots).toHaveProperty("hackernews");
    expect(config.bots.hackernews.feed_url).toBe("https://news.ycombinator.com/rss");
    expect(config.bots.hackernews.display_name).toBe("Hacker News");
    expect(config.bots.hackernews.summary).toBe("Top stories from Hacker News");
  });

  it("parses multiple bots", () => {
    const config = parseConfig(`
bots:
  bot_a:
    feed_url: "https://example.com/a.xml"
    display_name: "Bot A"
    summary: "First bot"
  bot_b:
    feed_url: "https://example.com/b.xml"
    display_name: "Bot B"
    summary: "Second bot"
`);
    expect(Object.keys(config.bots)).toEqual(["bot_a", "bot_b"]);
  });

  it("rejects config with no bots", () => {
    expect(() => parseConfig("bots: {}")).toThrow();
  });

  it("rejects config with missing feed_url", () => {
    expect(() =>
      parseConfig(`
bots:
  test:
    display_name: "Test"
    summary: "Test bot"
`),
    ).toThrow();
  });

  it("rejects config with invalid feed_url", () => {
    expect(() =>
      parseConfig(`
bots:
  test:
    feed_url: "not-a-url"
    display_name: "Test"
    summary: "Test bot"
`),
    ).toThrow();
  });

  it("rejects bot usernames with uppercase letters", () => {
    expect(() =>
      parseConfig(`
bots:
  MyBot:
    feed_url: "https://example.com/rss"
    display_name: "My Bot"
    summary: "Test"
`),
    ).toThrow();
  });

  it("rejects config with empty display_name", () => {
    expect(() =>
      parseConfig(`
bots:
  test:
    feed_url: "https://example.com/rss"
    display_name: ""
    summary: "A bot"
`),
    ).toThrow();
  });
});

describe("loadConfig", () => {
  it("loads the example feeds.yml", () => {
    const config = loadConfig(join(import.meta.dirname!, "..", "..", "feeds.yml"));
    expect(Object.keys(config.bots).length).toBeGreaterThanOrEqual(1);
    for (const bot of Object.values(config.bots)) {
      expect(bot.feed_url).toMatch(/^https?:\/\//);
      expect(bot.display_name.length).toBeGreaterThan(0);
    }
  });
});

describe("getBlockedInstances", () => {
  const envKey = "BLOCKED_INSTANCES";

  afterEach(() => {
    delete process.env[envKey];
  });

  it("returns empty set when BLOCKED_INSTANCES is unset", () => {
    expect(getBlockedInstances()).toEqual(new Set());
  });

  it("returns empty set when BLOCKED_INSTANCES is empty string", () => {
    process.env[envKey] = "";
    expect(getBlockedInstances()).toEqual(new Set());
  });

  it("parses comma-separated hostnames and lowercases them", () => {
    process.env[envKey] = "Spam.Example.COM , bad.instance";
    const blocked = getBlockedInstances();
    expect(blocked.size).toBe(2);
    expect(blocked.has("spam.example.com")).toBe(true);
    expect(blocked.has("bad.instance")).toBe(true);
  });
});
