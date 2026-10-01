import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { MemoryKvStore, type Message, type MessageQueue } from "@fedify/fedify";
import { parseConfig } from "../config";
import { Accept, type Activity, Application, Endpoints, EmojiReact, Follow, Like, Note, Reject, Announce } from "@fedify/vocab";
import { createDb, getAllFollowing, getFollowers, insertEntry, migrate, upsertFollowing } from "../db";
import { registerInboxListeners, setupFederation } from "../federation";
import { feedEntries, followers, following, reactions } from "../schema";

const bot = "block_test";
const blocked = new Set(["blocked.example"]);
const good = new URL("https://good.example/users/a");
const bad = new URL("https://blocked.example/users/b");

describe.skipIf(!process.env.DATABASE_URL)("inbox listeners honor the blocklist", () => {
  const client = postgres(process.env.DATABASE_URL ?? "postgres://unused");
  const db = createDb(client);
  // A real federation (the mock's parseUri treats every /users/ path as an
  // actor); deliveries land in a recording queue instead of the network.
  const sent: Message[] = [];
  const queue: MessageQueue = { enqueue: async (m) => void sent.push(m as Message), listen: async () => {} };
  const config = parseConfig(`
bots:
  ${bot}:
    feed_url: https://example.com/rss
    display_name: Block test
    summary: Block test.
`);
  const federation = setupFederation({ config, db, kvStore: new MemoryKvStore(), messageQueue: queue, origin: "https://robot.test", blockedInstances: blocked });
  const ctx = federation.createContext(new URL("https://robot.test"));
  // Capture the registered listeners and call them directly by activity class.
  type Listener = (c: typeof ctx, a: Activity) => unknown;
  const listeners = new Map<unknown, Listener>();
  const setters = {
    setSharedKeyDispatcher: () => setters,
    on: (type: unknown, listener: Listener) => (listeners.set(type, listener), setters),
    onRequestFinished: () => setters,
    onError: () => setters,
  };
  registerInboxListeners({ setInboxListeners: () => setters } as never, db, [bot], blocked);
  const receive = async (activity: Activity) => {
    await listeners.get(activity.constructor)!(ctx, activity);
  };
  let entryId: number;

  beforeAll(() => migrate(db));
  beforeEach(async () => {
    const entries = await db.select().from(feedEntries).where(eq(feedEntries.botUsername, bot));
    for (const e of entries) {
      await db.delete(reactions).where(eq(reactions.entryId, e.id));
    }
    await db.delete(feedEntries).where(eq(feedEntries.botUsername, bot));
    await db.delete(followers).where(eq(followers.botUsername, bot));
    await db.delete(following).where(eq(following.botUsername, bot));
    entryId = (await insertEntry(db, bot, "g", "https://example.com", "t", null, []))!;
    sent.length = 0;
  });
  afterAll(() => client.end());

  const post = () => ctx.getObjectUri(Note, { identifier: bot, id: String(entryId) });
  const counts = async () => {
    const [row] = await db.select().from(feedEntries).where(eq(feedEntries.id, entryId));
    return { likes: row.likeCount, boosts: row.boostCount };
  };

  it("ignores reactions from blocked hosts but counts allowed ones", async () => {
    for (const actor of [bad, good]) {
      await receive(new Like({ id: new URL(`${actor}/like`), actor, object: post() }));
      await receive(new EmojiReact({ id: new URL(`${actor}/emoji`), actor, object: post(), content: "🎉" }));
      await receive(new Announce({ id: new URL(`${actor}/boost`), actor, object: post() }));
    }
    expect(await counts()).toEqual({ likes: 2, boosts: 1 });
  });

  it("ignores Accept and Reject from blocked hosts", async () => {
    await upsertFollowing(db, bot, "b@blocked.example", bad.href, "https://robot.test/f/1");
    const follow = new Follow({ id: new URL("https://robot.test/f/1"), actor: ctx.getActorUri(bot), object: bad });
    await receive(new Accept({ actor: bad, object: follow }));
    await receive(new Reject({ actor: bad, object: follow }));
    expect((await getAllFollowing(db)).find((f) => f.botUsername === bot)?.status).toBe("pending");
  });

  it("rejects a Follow whose shared inbox is on a blocked host", async () => {
    const actor = new Application({
      id: good,
      inbox: new URL("https://good.example/inbox"),
      endpoints: new Endpoints({ sharedInbox: new URL("https://blocked.example/inbox") }),
    });
    await receive(new Follow({ id: new URL(`${good}/follow`), actor, object: ctx.getActorUri(bot) }));
    expect(await getFollowers(db, bot)).toEqual([]);
    expect(JSON.stringify(sent)).toContain("Reject");
    expect(JSON.stringify(sent)).not.toContain("Accept");
  });
});
