import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FeedsConfig } from "./config";
import { getEntriesPage, searchEntries, type Db } from "./db";
import { entryObjectUrl, type FeedEntry } from "./feed-entry";

const MAX_RESULTS = 50;

interface McpDeps {
  db: Db;
  config: FeedsConfig;
  domain: string;
}

function feedResult(domain: string, username: string, bot: FeedsConfig["bots"][string]) {
  return {
    username,
    handle: `@${username}@${domain}`,
    profile_url: `https://${domain}/bot/${username}`,
    display_name: bot.display_name,
    summary: bot.summary,
    feed_url: bot.feed_url,
    homepage_url: bot.homepage_url,
    default_hashtags: bot.default_hashtags ?? [],
  };
}

function postResult(domain: string, entry: FeedEntry) {
  return {
    title: entry.title,
    url: entry.url,
    bot: entry.botUsername,
    fediverse_url: entryObjectUrl(domain, entry.botUsername, entry.id),
    published_at: entry.publishedAt?.toISOString() ?? null,
    hashtags: entry.hashtags,
    likes: entry.likeCount,
    boosts: entry.boostCount,
  };
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/** Read-only MCP server exposing feed and post search. */
export function createMcpServer({ db, config, domain }: McpDeps): McpServer {
  const server = new McpServer({ name: "robot.villas", version: "1.0.0" });
  const limit = z.number().int().min(1).max(MAX_RESULTS).default(20);

  server.registerTool(
    "search_feeds",
    {
      title: "Search feeds",
      description:
        "Find robot.villas RSS/Atom feed bots about a topic. Matches handle, display name, summary, feed URL, and default hashtags (case-insensitive substring). Empty query lists all feeds.",
      inputSchema: { query: z.string().describe("Topic or keyword, e.g. \"rust\" or \"synthesizers\""), limit },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, limit }) => {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const results = Object.entries(config.bots)
        .map(([username, bot]) => {
          const haystack = [`@${username}@${domain}`, bot.display_name, bot.summary, bot.feed_url ?? "", bot.homepage_url ?? "", ...(bot.default_hashtags ?? [])]
            .join(" ")
            .toLowerCase();
          return { username, bot, score: words.filter((w) => haystack.includes(w)).length };
        })
        .filter(({ score }) => words.length === 0 || score > 0)
        .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
      return json({
        total: results.length,
        feeds: results.slice(0, limit).map(({ username, bot }) => feedResult(domain, username, bot)),
      });
    },
  );

  server.registerTool(
    "search_posts",
    {
      title: "Search posts",
      description:
        "Search posts published by robot.villas bots. Matches post titles and hashtags (case-insensitive substring), newest first. Optionally restrict to one bot username.",
      inputSchema: {
        query: z.string().min(1).describe("Topic or keyword to look for in post titles and hashtags"),
        bot: z.string().optional().describe("Bot username (from search_feeds) to restrict results to"),
        limit,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, bot, limit }) => {
      const entries = await searchEntries(db, query.trim(), limit, bot);
      return json({ posts: entries.map((e) => postResult(domain, e)) });
    },
  );

  server.registerTool(
    "get_feed_posts",
    {
      title: "Get recent feed posts",
      description: "List the most recent posts from one robot.villas bot.",
      inputSchema: { bot: z.string().describe("Bot username"), limit },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ bot, limit }) => {
      const config_ = config.bots[bot];
      if (!config_) {
        return { ...json({ error: `Unknown bot: ${bot}` }), isError: true };
      }
      const entries = await getEntriesPage(db, bot, limit, 0);
      return json({ feed: feedResult(domain, bot, config_), posts: entries.map((e) => postResult(domain, e)) });
    },
  );

  return server;
}
