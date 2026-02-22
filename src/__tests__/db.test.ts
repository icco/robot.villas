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
  getKeypairs,
  saveKeypairs,
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
    await client`
      CREATE TABLE IF NOT EXISTS feed_entries (
        id            INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
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
        id            INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        bot_username  TEXT NOT NULL,
        follower_id   TEXT NOT NULL,
        follow_id     TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (bot_username, follower_id)
      )
    `;
  });

  afterAll(async () => {
    await db.delete(schema.feedEntries).where(rawSql`1=1`);
    await db.delete(schema.actorKeypairs).where(rawSql`1=1`);
    await db.delete(schema.followers).where(rawSql`1=1`);
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
      await client`
        INSERT INTO actor_keypairs (bot_username, public_key, private_key)
        VALUES ('legacybot', ${JSON.stringify(pub)}::jsonb, ${JSON.stringify(priv)}::jsonb)
      `;
      const kps = await getKeypairs(db, "legacybot");
      expect(kps).toHaveLength(1);
      expect(kps![0].publicKey).toMatchObject({ kty: "RSA", n: "legacy" });
    });
  });
});
