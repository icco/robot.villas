import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { type Context, MemoryKvStore } from "@fedify/fedify";
import { Person } from "@fedify/vocab";
import { createDb, insertEntry, migrate } from "../db";
import { receiveReaction } from "../inbox-state";
import * as schema from "../schema";
import { deliverPostWebmention, deliverReactionWebmention, type WebmentionDeps } from "../webmentions";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("webmention delivery opt-out", () => {
  const client = postgres(databaseUrl ?? "postgres://unused");
  const db = createDb(client);
  const enabled = "wm_enabled_test";
  const optedOut = "wm_opted_out_test";
  const bob = "https://bob.example/users/bob";
  const ctx = {
    getDocumentLoader: async () => async () => {
      throw new Error("no remote documents in tests");
    },
    lookupObject: async (id: string) => new Person({ id: new URL(id), name: "Bob", preferredUsername: "bob" }),
  } as unknown as Context<void>;
  const originalFetch = globalThis.fetch;
  let fetch: ReturnType<typeof vi.fn<(url: URL, init: RequestInit) => Promise<Response>>>;
  let deps: WebmentionDeps;
  const entries: Record<string, number> = {};

  beforeAll(() => migrate(db));
  beforeEach(async () => {
    await db.delete(schema.reactions).where(eq(schema.reactions.actorId, bob));
    await db.delete(schema.remoteActors).where(eq(schema.remoteActors.actorId, bob));
    await db.delete(schema.feedEntries).where(inArray(schema.feedEntries.botUsername, [enabled, optedOut]));
    for (const bot of [enabled, optedOut]) {
      entries[bot] = (await insertEntry(db, bot, "entry", `https://ada.example/${bot}`, "Hello", new Date(), []))!;
    }
    deps = { db, kv: new MemoryKvStore(), domain: "robot.test", botUsernames: [enabled, optedOut], webmentionBots: [enabled] };
    fetch = vi.fn(async (_url: URL, init: RequestInit) => init.method === "POST"
      ? new Response("", { status: 202 })
      : new Response(`<link rel="webmention" href="/wm">`, { headers: { "content-type": "text/html" } }));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterAll(() => client.end());

  const sent = () => fetch.mock.calls.filter(([, init]) => init.method === "POST")
    .map(([, init]) => Object.fromEntries(new URLSearchParams(String(init.body))));
  const react = async (bot: string, undo = false) => {
    const activityId = `${bob}/likes/${bot}`;
    await receiveReaction(db, { activityId, actorId: bob, botUsername: bot, entryId: entries[bot], kind: "like", content: "" }, undo);
    return activityId;
  };

  it("sends posts only for bots that allow webmentions", async () => {
    await deliverPostWebmention(deps, entries[optedOut]);
    expect(fetch).not.toHaveBeenCalled();
    await deliverPostWebmention(deps, entries[enabled]);
    expect(sent()).toEqual([{ source: `https://robot.test/users/${enabled}/posts/${entries[enabled]}`, target: `https://ada.example/${enabled}` }]);
  });

  it("caches the reacting profile but sends nothing for an opted-out bot", async () => {
    await deliverReactionWebmention(ctx, deps, await react(optedOut));
    expect(fetch).not.toHaveBeenCalled();
    const [actor] = await db.select().from(schema.remoteActors).where(eq(schema.remoteActors.actorId, bob));
    expect(actor).toMatchObject({ name: "Bob", excludedReason: null });
  });

  it("sends no retraction for an opted-out bot", async () => {
    await deliverReactionWebmention(ctx, deps, await react(optedOut));
    await deliverReactionWebmention(ctx, deps, await react(optedOut, true));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends reactions and retractions for a bot that allows webmentions", async () => {
    await deliverReactionWebmention(ctx, deps, await react(enabled));
    await deliverReactionWebmention(ctx, deps, await react(enabled, true));
    expect(sent()).toHaveLength(2);
    expect(sent()[0].target).toBe(`https://ada.example/${enabled}`);
  });
});
