import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { sql as rawSql } from "drizzle-orm";
import {
  createDb,
  hasEntry,
  insertEntry,
  getFollowers,
  addFollower,
  removeFollower,
  getKeypair,
  saveKeypair,
  type Db,
} from "../db.js";
import * as schema from "../schema.js";

const DATABASE_URL = process.env.DATABASE_URL;

const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb("database", () => {
  let client: postgres.Sql;
  let db: Db;

  beforeAll(async () => {
    client = postgres(DATABASE_URL!);
    db = createDb(client);
    // Push schema directly for tests
    await client`
      CREATE TABLE IF NOT EXISTS feed_entries (
        id            SERIAL PRIMARY KEY,
        bot_username  TEXT NOT NULL,
        guid          TEXT NOT NULL,
        url           TEXT NOT NULL,
        title         TEXT NOT NULL,
        published_at  TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (bot_username, guid)
      )
    `;
    await client`
      CREATE TABLE IF NOT EXISTS actor_keypairs (
        bot_username  TEXT PRIMARY KEY,
        public_key    JSONB NOT NULL,
        private_key   JSONB NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await client`
      CREATE TABLE IF NOT EXISTS followers (
        id            SERIAL PRIMARY KEY,
        bot_username  TEXT NOT NULL,
        follower_id   TEXT NOT NULL,
        follow_id     TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (bot_username, follower_id)
      )
    `;
  });

  afterAll(async () => {
    await client`DROP TABLE IF EXISTS feed_entries, actor_keypairs, followers`;
    await client.end();
  });

  beforeEach(async () => {
    await db.delete(schema.feedEntries).where(rawSql`1=1`);
    await db.delete(schema.actorKeypairs).where(rawSql`1=1`);
    await db.delete(schema.followers).where(rawSql`1=1`);
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
      expect(await getKeypair(db, "testbot")).toBeNull();
      const pub = { kty: "RSA", n: "test-n", e: "AQAB" } as JsonWebKey;
      const priv = { kty: "RSA", n: "test-n", e: "AQAB", d: "test-d" } as JsonWebKey;
      await saveKeypair(db, "testbot", pub, priv);
      const kp = await getKeypair(db, "testbot");
      expect(kp).not.toBeNull();
      expect(kp!.publicKey).toMatchObject({ kty: "RSA", n: "test-n" });
      expect(kp!.privateKey).toMatchObject({ kty: "RSA", d: "test-d" });
    });

    it("does not overwrite existing keypair", async () => {
      const pub1 = { kty: "RSA", n: "first" } as JsonWebKey;
      const priv1 = { kty: "RSA", d: "first" } as JsonWebKey;
      const pub2 = { kty: "RSA", n: "second" } as JsonWebKey;
      const priv2 = { kty: "RSA", d: "second" } as JsonWebKey;
      await saveKeypair(db, "testbot", pub1, priv1);
      await saveKeypair(db, "testbot", pub2, priv2);
      const kp = await getKeypair(db, "testbot");
      expect(kp!.publicKey).toMatchObject({ n: "first" });
    });
  });
});
