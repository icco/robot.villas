import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { inArray } from "drizzle-orm";
import {
  createDb,
  migrate,
  migrateWithRetry,
  hasEntry,
  getExistingGuids,
  insertEntry,
  countEntriesForBots,
  getTagsPage,
  getFollowers,
  addFollower,
  removeFollower,
  getKeypairs,
  saveKeypairs,
  upsertFeedPollStatus,
  removeFeedPollStatus,
  getFeedPollStatusMap,
  upsertFollowing,
  markFollowingAccepted,
  getAllFollowing,
  updateFollowingStatus,
  upsertRelay,
  updateRelayStatus,
  getAllRelays,
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
  await db.delete(schema.feedPollStatus).where(inArray(schema.feedPollStatus.botUsername, TEST_BOTS));
  await db.delete(schema.following).where(inArray(schema.following.botUsername, TEST_BOTS));
  await db.delete(schema.relays).where(inArray(schema.relays.botUsername, TEST_BOTS));
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
      await insertEntry(db, "testbot", "guid-1", "https://example.com/1", "Title 1", new Date(), [
        "One",
        "Two",
        "Three",
      ]);
      expect(await hasEntry(db, "testbot", "guid-1")).toBe(true);
    });

    it("handles duplicate inserts gracefully", async () => {
      await insertEntry(db, "testbot", "guid-dup", "https://example.com/dup", "Dup", null, ["A", "B", "C"]);
      await insertEntry(db, "testbot", "guid-dup", "https://example.com/dup", "Dup", null, ["A", "B", "C"]);
      expect(await hasEntry(db, "testbot", "guid-dup")).toBe(true);
    });

    it("scopes entries to bot username", async () => {
      await insertEntry(db, "bot_a", "guid-x", "https://example.com/x", "X", null, ["X", "Y", "Z"]);
      expect(await hasEntry(db, "bot_a", "guid-x")).toBe(true);
      expect(await hasEntry(db, "bot_b", "guid-x")).toBe(false);
    });

    it("getExistingGuids returns the subset of guids that already exist", async () => {
      await insertEntry(db, "testbot", "guid-1", "https://example.com/1", "Title 1", null, []);
      await insertEntry(db, "testbot", "guid-2", "https://example.com/2", "Title 2", null, []);

      const existing = await getExistingGuids(db, "testbot", ["guid-1", "guid-2", "guid-missing"]);
      expect(existing).toEqual(new Set(["guid-1", "guid-2"]));
    });

    it("getExistingGuids scopes to bot username and ignores soft-deleted rows", async () => {
      await insertEntry(db, "bot_a", "guid-shared", "https://example.com/shared", "Shared", null, []);
      expect(await getExistingGuids(db, "bot_b", ["guid-shared"])).toEqual(new Set());

      await db
        .update(schema.feedEntries)
        .set({ deletedAt: new Date() })
        .where(inArray(schema.feedEntries.botUsername, ["bot_a"]));
      expect(await getExistingGuids(db, "bot_a", ["guid-shared"])).toEqual(new Set());
    });

    it("getExistingGuids returns an empty set for an empty guid list", async () => {
      expect(await getExistingGuids(db, "testbot", [])).toEqual(new Set());
    });
  });

  describe("countEntriesForBots", () => {
    it("sums non-deleted entries across all given bots in one query", async () => {
      await insertEntry(db, "testbot", "guid-1", "https://example.com/1", "T1", null, []);
      await insertEntry(db, "testbot", "guid-2", "https://example.com/2", "T2", null, []);
      await insertEntry(db, "bot_a", "guid-3", "https://example.com/3", "T3", null, []);

      expect(await countEntriesForBots(db, ["testbot", "bot_a"])).toBe(3);
      expect(await countEntriesForBots(db, ["testbot"])).toBe(2);
    });

    it("ignores bots not in the given list and soft-deleted entries", async () => {
      await insertEntry(db, "testbot", "guid-1", "https://example.com/1", "T1", null, []);
      await insertEntry(db, "bot_a", "guid-2", "https://example.com/2", "T2", null, []);

      expect(await countEntriesForBots(db, ["testbot"])).toBe(1);

      await db
        .update(schema.feedEntries)
        .set({ deletedAt: new Date() })
        .where(inArray(schema.feedEntries.botUsername, ["testbot"]));
      expect(await countEntriesForBots(db, ["testbot", "bot_a"])).toBe(1);
    });

    it("returns 0 for an empty bot list", async () => {
      expect(await countEntriesForBots(db, [])).toBe(0);
    });
  });

  // Tag counts are global, not per-bot, so every assertion here is relative to
  // a baseline taken after cleanup and filtered to this prefix — the suite
  // stays deterministic against a database that holds other bots' entries.
  describe("getTagsPage", () => {
    const PREFIX = "zztagfixture";
    const SHARED = `${PREFIX}shared`;

    /** All pages walked end to end, plus the total the query reports. */
    async function walkAllPages(limit: number) {
      const collected: Array<{ tag: string; postCount: number }> = [];
      let total = 0;
      for (let offset = 0; ; offset += limit) {
        const page = await getTagsPage(db, limit, offset);
        total = page.total || total;
        collected.push(...page.tags);
        if (page.tags.length < limit) {
          break;
        }
      }
      return { collected, total };
    }

    const fixtureTags = (tags: Array<{ tag: string; postCount: number }>) =>
      tags.filter((t) => t.tag.startsWith(PREFIX));

    async function baselineTotal() {
      return (await getTagsPage(db, 1, 0)).total;
    }

    // SHARED lands on 3 entries and the rest on 1 apiece, so ordering exercises
    // the post-count sort and the tag tie-break that breaks its ties.
    async function seedTags() {
      await insertEntry(db, "testbot", "t-1", "https://example.com/1", "T1", null, [`${PREFIX}Shared`, `${PREFIX}Gamma`]);
      await insertEntry(db, "testbot", "t-2", "https://example.com/2", "T2", null, [SHARED, `${PREFIX}Beta`]);
      await insertEntry(db, "bot_a", "t-3", "https://example.com/3", "T3", null, [SHARED.toUpperCase(), `${PREFIX}Alpha`]);
    }

    it("orders by post count then tag, and counts each tag once", async () => {
      const base = await baselineTotal();
      await seedTags();

      const { tags, total } = await getTagsPage(db, 10_000, 0);
      expect(total).toBe(base + 4);
      expect(fixtureTags(tags)).toEqual([
        { tag: SHARED, postCount: 3 },
        { tag: `${PREFIX}alpha`, postCount: 1 },
        { tag: `${PREFIX}beta`, postCount: 1 },
        { tag: `${PREFIX}gamma`, postCount: 1 },
      ]);
    });

    it("pages without dropping or repeating equally-ranked tags", async () => {
      await seedTags();

      // Without the `tag ASC` tie-break, equal post counts order arbitrarily
      // per query, so a walk like this both repeats and misses tags.
      const { collected, total } = await walkAllPages(2);

      expect(collected).toHaveLength(total);
      expect(new Set(collected.map((t) => t.tag)).size).toBe(total);
      expect(fixtureTags(collected).map((t) => t.tag)).toEqual([
        SHARED,
        `${PREFIX}alpha`,
        `${PREFIX}beta`,
        `${PREFIX}gamma`,
      ]);
    });

    it("ignores soft-deleted entries", async () => {
      const base = await baselineTotal();
      await seedTags();
      await db
        .update(schema.feedEntries)
        .set({ deletedAt: new Date() })
        .where(inArray(schema.feedEntries.botUsername, ["testbot"]));

      const { tags, total } = await getTagsPage(db, 10_000, 0);
      expect(total).toBe(base + 2);
      expect(fixtureTags(tags)).toEqual([
        { tag: `${PREFIX}alpha`, postCount: 1 },
        { tag: SHARED, postCount: 1 },
      ]);
    });

    it("returns an empty page past the last one", async () => {
      await seedTags();
      const { total } = await getTagsPage(db, 1, 0);

      expect(await getTagsPage(db, 100, total)).toEqual({ tags: [], total: 0 });
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

  describe("feed_poll_status cleanup", () => {
    it("removeFeedPollStatus deletes only that bot's row", async () => {
      // Removing a bot left its poll status behind — 18 orphans accumulated
      // in prod because the deleted-bot cleanup never touched this table.
      for (const botUsername of ["bot_a", "bot_b"]) {
        await upsertFeedPollStatus(db, {
          botUsername,
          lastCheckedAt: new Date(),
          lastHttpStatus: 200,
          lastError: null,
          etag: null,
          lastModified: null,
          nextPollAt: null,
        });
      }

      await removeFeedPollStatus(db, "bot_a");

      const remaining = await getFeedPollStatusMap(db, ["bot_a", "bot_b"]);
      expect(remaining.has("bot_a")).toBe(false);
      expect(remaining.has("bot_b")).toBe(true);
    });
  });

  describe("following", () => {
    const HANDLE = "_followback@example.test";

    async function seedPending(bots: string[]) {
      for (const botUsername of bots) {
        await upsertFollowing(db, botUsername, HANDLE, "https://example.test/user/_followback", `https://robot.test/users/${botUsername}/follows/1`);
      }
    }

    it("markFollowingAccepted flips only the named bots", async () => {
      await seedPending(["bot_a", "bot_b"]);

      await markFollowingAccepted(db, HANDLE, ["bot_a"]);

      const rows = await getAllFollowing(db);
      const byBot = new Map(rows.filter((r) => r.handle === HANDLE).map((r) => [r.botUsername, r.status]));
      expect(byBot.get("bot_a")).toBe("accepted");
      expect(byBot.get("bot_b")).toBe("pending");
    });

    it("markFollowingAccepted records when the status changed", async () => {
      await seedPending(["bot_a"]);
      await markFollowingAccepted(db, HANDLE, ["bot_a"]);

      const [row] = await db
        .select({ statusChangedAt: schema.following.statusChangedAt })
        .from(schema.following)
        .where(inArray(schema.following.botUsername, ["bot_a"]));
      expect(row.statusChangedAt).toBeInstanceOf(Date);
    });

    it("markFollowingAccepted is a no-op for an empty bot list", async () => {
      await seedPending(["bot_a"]);
      await markFollowingAccepted(db, HANDLE, []);

      const rows = await getAllFollowing(db);
      expect(rows.find((r) => r.botUsername === "bot_a")?.status).toBe("pending");
    });

    it("markFollowingAccepted leaves an explicit Reject alone", async () => {
      // The pending set is a snapshot; a Reject can land before we write.
      await seedPending(["bot_a"]);
      await updateFollowingStatus(db, "https://robot.test/users/bot_a/follows/1", "rejected");

      await markFollowingAccepted(db, HANDLE, ["bot_a"]);

      const rows = await getAllFollowing(db);
      expect(rows.find((r) => r.botUsername === "bot_a")?.status).toBe("rejected");
    });

    it("markFollowingAccepted does not touch other handles", async () => {
      await upsertFollowing(db, "bot_a", "someone@example.test", "https://example.test/user/someone", "https://robot.test/f/2");
      await seedPending(["bot_a"]);

      await markFollowingAccepted(db, HANDLE, ["bot_a"]);

      const rows = await getAllFollowing(db);
      expect(rows.find((r) => r.handle === "someone@example.test")?.status).toBe("pending");
    });
  });

  describe("relays", () => {
    const URL = "https://relay.example.test/actor";
    const seed = () =>
      upsertRelay(db, "bot_a", URL, `${URL.replace("/actor", "/inbox")}`, URL, "https://robot.test/f/relay-1");

    const relayRow = async () => (await getAllRelays(db, "bot_a")).find((r) => r.url === URL);

    it("upsertRelay does not restamp a row that is already pending", async () => {
      // Otherwise a permanently-pending relay looks freshly changed on every
      // boot, hiding exactly the stuck state the column exists to surface.
      await seed();
      const first = (await relayRow())!.statusChangedAt;
      expect(first).toBeInstanceOf(Date);

      await seed();
      expect((await relayRow())!.statusChangedAt?.getTime()).toBe(first!.getTime());
    });

    it("upsertRelay restamps when reviving a rejected row", async () => {
      await seed();
      await updateRelayStatus(db, "https://robot.test/f/relay-1", "rejected");
      const rejectedAt = (await relayRow())!.statusChangedAt!;
      await db
        .update(schema.relays)
        .set({ statusChangedAt: new Date(rejectedAt.getTime() - 60_000) })
        .where(inArray(schema.relays.botUsername, ["bot_a"]));

      await seed();

      const row = (await relayRow())!;
      expect(row.status).toBe("pending");
      expect(row.statusChangedAt!.getTime()).toBeGreaterThan(rejectedAt.getTime() - 60_000);
    });

    it("upsertRelay backfills a null timestamp on a pending row", async () => {
      await seed();
      await db
        .update(schema.relays)
        .set({ statusChangedAt: null })
        .where(inArray(schema.relays.botUsername, ["bot_a"]));

      await seed();
      expect((await relayRow())!.statusChangedAt).toBeInstanceOf(Date);
    });
  });
});

describe("migrateWithRetry", () => {
  const fakeDb = {} as Parameters<typeof migrateWithRetry>[0];

  function unreachable(): Error {
    return Object.assign(new Error("connect EHOSTUNREACH"), { code: "EHOSTUNREACH" });
  }

  it("succeeds without sleeping when the database is already up", async () => {
    const slept: number[] = [];
    let calls = 0;

    await migrateWithRetry(fakeDb, undefined, {
      run: async () => {
        calls++;
      },
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    expect(calls).toBe(1);
    expect(slept).toEqual([]);
  });

  it("retries with backoff while the database is still coming up", async () => {
    const slept: number[] = [];
    const retries: number[] = [];
    let calls = 0;

    await migrateWithRetry(fakeDb, (attempt) => retries.push(attempt), {
      run: async () => {
        if (++calls < 3) {
          throw unreachable();
        }
      },
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    expect(calls).toBe(3);
    expect(slept).toEqual([1_000, 2_000]);
    expect(retries).toEqual([1, 2]);
  });

  it("rethrows the last error once attempts are exhausted, so a broken migration surfaces", async () => {
    const slept: number[] = [];
    let calls = 0;

    const attempt = migrateWithRetry(fakeDb, undefined, {
      run: async () => {
        calls++;
        throw unreachable();
      },
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    await expect(attempt).rejects.toThrow("connect EHOSTUNREACH");
    expect(calls).toBe(6);
    expect(slept).toEqual([1_000, 2_000, 4_000, 8_000, 15_000]);
  });
});
