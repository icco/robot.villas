import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { inArray } from "drizzle-orm";
import {
  createDb,
  migrate,
  hasEntry,
  insertEntry,
  getFollowers,
  addFollower,
  removeFollower,
  getKeypairs,
  saveKeypairs,
  type Db,
} from "../db";
import * as schema from "../schema";

const DATABASE_URL = process.env.DATABASE_URL;

const describeWithDb = DATABASE_URL ? describe : describe.skip;

const TEST_BOTS = ["testbot", "bot_a", "bot_b", "legacybot"];

async function cleanTestData(db: Db) {
  await db.delete(schema.feedEntries).where(inArray(schema.feedEntries.botUsername, TEST_BOTS));
  await db.delete(schema.actorKeypairs).where(inArray(schema.actorKeypairs.botUsername, TEST_BOTS));
  await db.delete(schema.followers).where(inArray(schema.followers.botUsername, TEST_BOTS));
}

describeWithDb("database", () => {
  let client: postgres.Sql;
  let db: Db;

  beforeAll(async () => {
    client = postgres(DATABASE_URL!);
    db = createDb(client);
    await migrate(db);
  });

  afterAll(async () => {
    await cleanTestData(db);
    await client.end();
  });

  beforeEach(async () => {
    await cleanTestData(db);
  });

  describe("feed_entries", () => {
    it("inserts and detects entries", async () => {
      expect(await hasEntry(db, "testbot", "guid-1")).toBe(false);
      await insertEntry(db, "testbot", "guid-1", "https://example.com/1", "Title 1", new Date());
      expect(await hasEntry(db, "testbot", "guid-1")).toBe(true);
    });

    it("handles duplicate inserts gracefully", async () => {
      await insertEntry(db, "testbot", "guid-dup", "https://example.com/dup", "Dup", null);
      await insertEntry(db, "testbot", "guid-dup", "https://example.com/dup", "Dup", null);
      expect(await hasEntry(db, "testbot", "guid-dup")).toBe(true);
    });

    it("scopes entries to bot username", async () => {
      await insertEntry(db, "bot_a", "guid-x", "https://example.com/x", "X", null);
      expect(await hasEntry(db, "bot_a", "guid-x")).toBe(true);
      expect(await hasEntry(db, "bot_b", "guid-x")).toBe(false);
    });
  });

  describe("followers", () => {
    it("adds and lists followers", async () => {
      expect(await getFollowers(db, "testbot")).toEqual([]);
      await addFollower(db, "testbot", "https://remote.example/user/1", "follow-1");
      await addFollower(db, "testbot", "https://remote.example/user/2", "follow-2");
      const followers = await getFollowers(db, "testbot");
      expect(followers).toHaveLength(2);
      expect(followers).toContain("https://remote.example/user/1");
    });

    it("removes followers", async () => {
      await addFollower(db, "testbot", "https://remote.example/user/1", "follow-1");
      await removeFollower(db, "testbot", "https://remote.example/user/1");
      expect(await getFollowers(db, "testbot")).toEqual([]);
    });

    it("handles duplicate follow gracefully", async () => {
      await addFollower(db, "testbot", "https://remote.example/user/1", "follow-1");
      await addFollower(db, "testbot", "https://remote.example/user/1", "follow-1-dup");
      expect(await getFollowers(db, "testbot")).toHaveLength(1);
    });
  });

  describe("actor_keypairs", () => {
    it("stores and retrieves keypairs", async () => {
      expect(await getKeypairs(db, "testbot")).toBeNull();
      const pub = { kty: "RSA", n: "test-n", e: "AQAB" } as JsonWebKey;
      const priv = { kty: "RSA", n: "test-n", e: "AQAB", d: "test-d" } as JsonWebKey;
      await saveKeypairs(db, "testbot", [{ publicKey: pub, privateKey: priv }]);
      const kps = await getKeypairs(db, "testbot");
      expect(kps).not.toBeNull();
      expect(kps).toHaveLength(1);
      expect(kps![0].publicKey).toMatchObject({ kty: "RSA", n: "test-n" });
      expect(kps![0].privateKey).toMatchObject({ kty: "RSA", d: "test-d" });
    });

    it("upserts keypairs when adding Ed25519 alongside RSA", async () => {
      const rsaPub = { kty: "RSA", n: "first" } as JsonWebKey;
      const rsaPriv = { kty: "RSA", d: "first" } as JsonWebKey;
      await saveKeypairs(db, "testbot", [{ publicKey: rsaPub, privateKey: rsaPriv }]);

      const ed25519Pub = { kty: "OKP", crv: "Ed25519", x: "ed-pub" } as JsonWebKey;
      const ed25519Priv = { kty: "OKP", crv: "Ed25519", x: "ed-pub", d: "ed-priv" } as JsonWebKey;
      await saveKeypairs(db, "testbot", [
        { publicKey: rsaPub, privateKey: rsaPriv },
        { publicKey: ed25519Pub, privateKey: ed25519Priv },
      ]);

      const kps = await getKeypairs(db, "testbot");
      expect(kps).toHaveLength(2);
      expect(kps![0].publicKey).toMatchObject({ kty: "RSA", n: "first" });
      expect(kps![1].publicKey).toMatchObject({ kty: "OKP", crv: "Ed25519" });
    });

    it("reads legacy single-JWK format as a single-element array", async () => {
      const pub = { kty: "RSA", n: "legacy" } as JsonWebKey;
      const priv = { kty: "RSA", d: "legacy" } as JsonWebKey;
      await db.insert(schema.actorKeypairs).values({
        botUsername: "legacybot",
        publicKey: pub,
        privateKey: priv,
      });
      const kps = await getKeypairs(db, "legacybot");
      expect(kps).toHaveLength(1);
      expect(kps![0].publicKey).toMatchObject({ kty: "RSA", n: "legacy" });
    });
  });
});
