import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { MemoryKvStore, InProcessMessageQueue } from "@fedify/fedify";
import { createDb, insertEntry, migrate } from "../db";
import { parseConfig } from "../config";
import { setupFederation } from "../federation";
import { feedEntries } from "../schema";
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
});
