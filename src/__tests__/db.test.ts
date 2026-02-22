import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createSql,
  migrate,
  hasEntry,
  insertEntry,
  getFollowers,
  addFollower,
  removeFollower,
  getKeypair,
  saveKeypair,
  type Sql,
} from "../db.js";

const DATABASE_URL = process.env.DATABASE_URL;

const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb("database", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createSql(DATABASE_URL!);
    await migrate(sql);
  });

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS feed_entries, actor_keypairs, followers`;
    await sql.end();
  });

  beforeEach(async () => {
    await sql`DELETE FROM feed_entries`;
    await sql`DELETE FROM actor_keypairs`;
    await sql`DELETE FROM followers`;
  });

  describe("feed_entries", () => {
    it("inserts and detects entries", async () => {
      expect(await hasEntry(sql, "testbot", "guid-1")).toBe(false);
      await insertEntry(sql, "testbot", "guid-1", "https://example.com/1", "Title 1", new Date());
      expect(await hasEntry(sql, "testbot", "guid-1")).toBe(true);
    });

    it("handles duplicate inserts gracefully", async () => {
      await insertEntry(sql, "testbot", "guid-dup", "https://example.com/dup", "Dup", null);
      await insertEntry(sql, "testbot", "guid-dup", "https://example.com/dup", "Dup", null);
      expect(await hasEntry(sql, "testbot", "guid-dup")).toBe(true);
    });

    it("scopes entries to bot username", async () => {
      await insertEntry(sql, "bot_a", "guid-x", "https://example.com/x", "X", null);
      expect(await hasEntry(sql, "bot_a", "guid-x")).toBe(true);
      expect(await hasEntry(sql, "bot_b", "guid-x")).toBe(false);
    });
  });

  describe("followers", () => {
    it("adds and lists followers", async () => {
      expect(await getFollowers(sql, "testbot")).toEqual([]);
      await addFollower(sql, "testbot", "https://remote.example/user/1", "follow-1");
      await addFollower(sql, "testbot", "https://remote.example/user/2", "follow-2");
      const followers = await getFollowers(sql, "testbot");
      expect(followers).toHaveLength(2);
      expect(followers).toContain("https://remote.example/user/1");
    });

    it("removes followers", async () => {
      await addFollower(sql, "testbot", "https://remote.example/user/1", "follow-1");
      await removeFollower(sql, "testbot", "https://remote.example/user/1");
      expect(await getFollowers(sql, "testbot")).toEqual([]);
    });

    it("handles duplicate follow gracefully", async () => {
      await addFollower(sql, "testbot", "https://remote.example/user/1", "follow-1");
      await addFollower(sql, "testbot", "https://remote.example/user/1", "follow-1-dup");
      expect(await getFollowers(sql, "testbot")).toHaveLength(1);
    });
  });

  describe("actor_keypairs", () => {
    it("stores and retrieves keypairs", async () => {
      expect(await getKeypair(sql, "testbot")).toBeNull();
      const pub = { kty: "RSA", n: "test-n", e: "AQAB" } as JsonWebKey;
      const priv = { kty: "RSA", n: "test-n", e: "AQAB", d: "test-d" } as JsonWebKey;
      await saveKeypair(sql, "testbot", pub, priv);
      const kp = await getKeypair(sql, "testbot");
      expect(kp).not.toBeNull();
      expect(kp!.publicKey).toMatchObject({ kty: "RSA", n: "test-n" });
      expect(kp!.privateKey).toMatchObject({ kty: "RSA", d: "test-d" });
    });

    it("does not overwrite existing keypair", async () => {
      const pub1 = { kty: "RSA", n: "first" } as JsonWebKey;
      const priv1 = { kty: "RSA", d: "first" } as JsonWebKey;
      const pub2 = { kty: "RSA", n: "second" } as JsonWebKey;
      const priv2 = { kty: "RSA", d: "second" } as JsonWebKey;
      await saveKeypair(sql, "testbot", pub1, priv1);
      await saveKeypair(sql, "testbot", pub2, priv2);
      const kp = await getKeypair(sql, "testbot");
      expect(kp!.publicKey).toMatchObject({ n: "first" });
    });
  });
});
