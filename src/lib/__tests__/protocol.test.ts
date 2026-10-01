import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { MemoryKvStore, InProcessMessageQueue } from "@fedify/fedify";
import { addFollower, createDb, insertEntry, migrate, removeKeypairs, saveKeypairs } from "../db";
import { parseConfig } from "../config";
import { setupFederation } from "../federation";
import { actorKeypairs, feedEntries, followers } from "../schema";
import { eq } from "drizzle-orm";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("served federation documents", () => {
  const client = postgres(databaseUrl ?? "postgres://unused");
  const db = createDb(client);
  const config = parseConfig(`
bots:
  protocol_test:
    feed_url: https://example.com/rss
    display_name: Protocol Test
    summary: A protocol test bot.
`);
  const federation = setupFederation({
    config, db, kvStore: new MemoryKvStore(), messageQueue: new InProcessMessageQueue(), origin: "https://robot.test",
  });
  const get = (path: string, accept = "application/activity+json") =>
    federation.fetch(new Request(`https://robot.test${path}`, { headers: { Accept: accept } }), { contextData: undefined });
  let entryId: number;

  beforeAll(async () => {
    await migrate(db);
    await db.delete(feedEntries).where(eq(feedEntries.botUsername, "protocol_test"));
    await db.delete(followers).where(eq(followers.botUsername, "protocol_test"));
    entryId = (await insertEntry(db, "protocol_test", "p1", "https://example.com/p1", "Hello", new Date(), []))!;
  });
  afterAll(() => client.end());

  it("answers WebFinger for a plain Accept header", async () => {
    const res = await get("/.well-known/webfinger?resource=acct:protocol_test@robot.test", "*/*");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subject).toBe("acct:protocol_test@robot.test");
    expect(body.links.some((l: { rel: string; href: string }) => l.rel === "self" && l.href === "https://robot.test/users/protocol_test")).toBe(true);
  });

  it("serves an actor with the collections and keys peers need", async () => {
    const res = await get("/users/protocol_test");
    expect(res.status).toBe(200);
    const actor = await res.json();
    expect(actor).toMatchObject({
      id: "https://robot.test/users/protocol_test",
      preferredUsername: "protocol_test",
      inbox: "https://robot.test/users/protocol_test/inbox",
      outbox: "https://robot.test/users/protocol_test/outbox",
      followers: "https://robot.test/users/protocol_test/followers",
      endpoints: { sharedInbox: "https://robot.test/inbox" },
    });
    expect(actor.publicKey?.publicKeyPem).toContain("BEGIN PUBLIC KEY");
  });

  it("serves notes and rejects malformed or out-of-range IDs", async () => {
    expect((await get(`/users/protocol_test/posts/${entryId}`)).status).toBe(200);
    for (const id of ["0", "01", "abc", "2147483648"]) {
      expect((await get(`/users/protocol_test/posts/${id}`)).status).toBe(404);
    }
  });

  it("pages the outbox and refuses invalid cursors", async () => {
    const page = await (await get("/users/protocol_test/outbox?cursor=0")).json();
    expect(page.orderedItems?.length ?? (page.orderedItems ? 1 : 0)).toBeGreaterThan(0);
    expect((await get("/users/protocol_test/outbox?cursor=-1")).status).toBe(404);
    expect((await get("/users/protocol_test/outbox?cursor=99999999999")).status).toBe(404);
  });

  it("does not serve unknown actors", async () => {
    expect((await get("/users/nobody")).status).toBe(404);
  });

  it("filters followers to the requesting server for followers synchronization", async () => {
    await addFollower(db, "protocol_test", "https://a.example/users/1", "https://a.example/f/1");
    await addFollower(db, "protocol_test", "https://b.example/users/2", "https://b.example/f/2");
    const all = await (await get("/users/protocol_test/followers")).json();
    const only = await (await get(`/users/protocol_test/followers?base-url=${encodeURIComponent("https://a.example/")}`)).json();
    expect(JSON.stringify(all)).toContain("b.example");
    expect(JSON.stringify(only)).toContain("https://a.example/users/1");
    expect(JSON.stringify(only)).not.toContain("b.example");
  });

  it("answers 410 with a Tombstone for deleted posts and removed bots", async () => {
    await db.update(feedEntries).set({ deletedAt: new Date() }).where(eq(feedEntries.id, entryId));
    const note = await get(`/users/protocol_test/posts/${entryId}`);
    expect(note.status).toBe(410);
    expect(await note.json()).toMatchObject({ type: "Tombstone", formerType: "as:Note" });

    await saveKeypairs(db, "removed_bot", [{ publicKey: {}, privateKey: {} }]);
    await removeKeypairs(db, "removed_bot");
    const actor = await get("/users/removed_bot");
    expect(actor.status).toBe(410);
    expect(await actor.json()).toMatchObject({ type: "Tombstone", formerType: "as:Application" });
    await db.delete(actorKeypairs).where(eq(actorKeypairs.botUsername, "removed_bot"));
  });
});
