import { describe, it, expect, afterEach } from "vitest";
import { getBlockedInstances, getRelaySubscriptionBot, parseConfig, loadConfig } from "../config";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { load as parseYaml } from "js-yaml";

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
    expect(config.bots.hackernews.profile_photo).toBeUndefined();
  });

  it("parses config with profile_photo", () => {
    const config = parseConfig(`
bots:
  hackernews:
    feed_url: "https://news.ycombinator.com/rss"
    display_name: "Hacker News"
    summary: "Top stories from Hacker News"
    profile_photo: "https://example.com/photo.png"
`);
    expect(config.bots.hackernews.profile_photo).toBe("https://example.com/photo.png");
  });

  it("rejects config with invalid profile_photo URL", () => {
    expect(() =>
      parseConfig(`
bots:
  test:
    feed_url: "https://example.com/rss"
    display_name: "Test"
    summary: "A bot"
    profile_photo: "not-a-url"
`),
    ).toThrow();
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

  it("rejects config with display_name over 100 chars", () => {
    expect(() =>
      parseConfig(`
bots:
  test:
    feed_url: "https://example.com/rss"
    display_name: "${"x".repeat(101)}"
    summary: "A bot"
`),
    ).toThrow();
  });

  it("rejects config with summary over 500 chars", () => {
    expect(() =>
      parseConfig(`
bots:
  test:
    feed_url: "https://example.com/rss"
    display_name: "Test"
    summary: "${"y".repeat(501)}"
`),
    ).toThrow();
  });

  it("accepts optional relay_subscription_bot and getRelaySubscriptionBot returns it", () => {
    const config = parseConfig(`
bots:
  a_bot:
    feed_url: "https://example.com/a.xml"
    display_name: "A"
    summary: "A"
  z_bot:
    feed_url: "https://example.com/z.xml"
    display_name: "Z"
    summary: "Z"
relay_subscription_bot: z_bot
relays: []
`);
    expect(getRelaySubscriptionBot(config)).toBe("z_bot");
  });

  it("rejects relay_subscription_bot that is not a bot key", () => {
    expect(() =>
      parseConfig(`
bots:
  only_bot:
    feed_url: "https://example.com/rss"
    display_name: "B"
    summary: "B"
relay_subscription_bot: not_a_key
`),
    ).toThrow();
  });
});

describe("loadConfig", () => {
  it("loads the example feeds.yml", () => {
    const config = loadConfig(join(import.meta.dirname!, "..", "..", "..", "feeds.yml"));
    expect(Object.keys(config.bots).length).toBeGreaterThanOrEqual(1);
    for (const bot of Object.values(config.bots)) {
      expect(bot.feed_url).toMatch(/^https?:\/\//);
      expect(bot.display_name.length).toBeGreaterThan(0);
    }
  });

  it("validates feeds.yml against feeds.schema.json", () => {
    const repoRoot = join(import.meta.dirname!, "..", "..", "..");
    const feedsYaml = readFileSync(join(repoRoot, "feeds.yml"), "utf-8");
    const schemaRaw = readFileSync(join(repoRoot, "feeds.schema.json"), "utf-8");

    const feedsData = parseYaml(feedsYaml) as Record<string, unknown>;
    const schema = JSON.parse(schemaRaw) as {
      required: string[];
      properties: Record<string, unknown>;
      $defs: { bot: { required: string[]; properties: Record<string, unknown> } };
    };

    const isUri = (value: unknown) => {
      if (typeof value !== "string") {
        return false;
      }
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    };

    for (const key of schema.required) {
      expect(feedsData[key]).toBeDefined();
    }

    const botPropertySchema = schema.properties.bots as {
      propertyNames: { pattern: string };
    };
    const botSchema = schema.$defs.bot;
    const botNameRe = new RegExp(botPropertySchema.propertyNames.pattern);
    const bots = feedsData.bots as Record<string, Record<string, unknown>>;
    expect(Object.keys(bots).length).toBeGreaterThanOrEqual(1);

    for (const [botName, bot] of Object.entries(bots)) {
      expect(botNameRe.test(botName)).toBe(true);
      for (const field of botSchema.required) {
        expect(bot[field]).toBeDefined();
      }

      expect(isUri(bot.feed_url)).toBe(true);
      expect(typeof bot.display_name).toBe("string");
      expect((bot.display_name as string).length).toBeGreaterThanOrEqual(1);
      expect((bot.display_name as string).length).toBeLessThanOrEqual(100);
      expect(typeof bot.summary).toBe("string");
      expect((bot.summary as string).length).toBeGreaterThanOrEqual(1);
      expect((bot.summary as string).length).toBeLessThanOrEqual(500);

      if (bot.profile_photo != null) {
        expect(isUri(bot.profile_photo)).toBe(true);
      }

      if (bot.default_hashtags != null) {
        expect(Array.isArray(bot.default_hashtags)).toBe(true);
        const hashtags = bot.default_hashtags as unknown[];
        expect(hashtags.length).toBeLessThanOrEqual(3);
        for (const hashtag of hashtags) {
          expect(typeof hashtag).toBe("string");
          expect((hashtag as string).length).toBeGreaterThanOrEqual(1);
          expect((hashtag as string).length).toBeLessThanOrEqual(30);
        }
      }
    }

    const follows = feedsData.follows;
    if (follows != null) {
      expect(Array.isArray(follows)).toBe(true);
      for (const follow of follows as unknown[]) {
        expect(typeof follow).toBe("string");
        expect((follow as string).length).toBeGreaterThanOrEqual(3);
      }
    }

    const relays = feedsData.relays;
    if (relays != null) {
      expect(Array.isArray(relays)).toBe(true);
      for (const relay of relays as unknown[]) {
        expect(isUri(relay)).toBe(true);
      }
    }

    const relaySubscriptionBot = feedsData.relay_subscription_bot;
    if (relaySubscriptionBot != null) {
      expect(typeof relaySubscriptionBot).toBe("string");
      expect(botNameRe.test(relaySubscriptionBot as string)).toBe(true);
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
