import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../config";
import type { Db } from "../db";
import { createMcpServer } from "../mcp";

const entry = {
  id: 7,
  botUsername: "rustblog",
  url: "https://blog.rust-lang.org/post",
  title: "Announcing Rust 2.0",
  publishedAt: new Date("2026-01-02T00:00:00Z"),
  likeCount: 1,
  boostCount: 2,
  hashtags: ["rust"],
};

vi.mock("../db", () => ({
  searchEntries: vi.fn(async () => [entry]),
  getEntriesPage: vi.fn(async () => [entry]),
}));

const config = parseConfig(`
bots:
  rustblog:
    feed_url: https://blog.rust-lang.org/feed.xml
    display_name: Rust Blog
    summary: News from the Rust programming language team
  synths:
    feed_url: https://example.com/synths.xml
    display_name: Synth News
    summary: Synthesizers and modular gear
    default_hashtags: [music]
`);

async function connect() {
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const server = createMcpServer({ db: {} as Db, config, domain: "robot.villas" });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(new Request(input, init));
  };
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("https://robot.villas/mcp"), { fetch: fetchImpl }));
  return client;
}

function parse(result: Awaited<ReturnType<Client["callTool"]>>) {
  return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
}

describe("mcp", () => {
  it("lists tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_feed_posts", "search_feeds", "search_posts"]);
  });

  it("searches feeds by topic", async () => {
    const client = await connect();
    const out = parse(await client.callTool({ name: "search_feeds", arguments: { query: "music" } }));
    expect(out.feeds.map((f: { username: string }) => f.username)).toEqual(["synths"]);
    expect(out.feeds[0].handle).toBe("@synths@robot.villas");
  });

  it("finds feeds by returned handle", async () => {
    const client = await connect();
    const out = parse(await client.callTool({ name: "search_feeds", arguments: { query: "@rustblog@robot.villas" } }));
    expect(out.feeds.map((f: { username: string }) => f.username)).toEqual(["rustblog"]);
  });

  it("searches posts", async () => {
    const client = await connect();
    const out = parse(await client.callTool({ name: "search_posts", arguments: { query: "rust" } }));
    expect(out.posts[0]).toMatchObject({
      title: "Announcing Rust 2.0",
      fediverse_url: "https://robot.villas/users/rustblog/posts/7",
    });
  });

  it("errors on unknown bot", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "get_feed_posts", arguments: { bot: "nope" } });
    expect(result.isError).toBe(true);
  });
});
