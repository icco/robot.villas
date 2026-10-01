import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { createFederation } from "@fedify/testing";
import { exportJwk, generateCryptoKeyPair } from "@fedify/fedify";
import { addFollower, claimFeedPoll, createDb, getAllBotUsernames, getFollowers, migrate, releaseFeedPoll, saveKeypairs, upsertFeedPollStatus } from "../db";
import { parseConfig } from "../config";
import { sendDeletedBotActivities } from "../federation";
import { actorKeypairs, feedPollStatus, followers } from "../schema";

describe.skipIf(!process.env.DATABASE_URL)("operational reliability", () => {
  const client = postgres(process.env.DATABASE_URL ?? "postgres://unused");
  const db = createDb(client);
  const fed = createFederation<void>({ origin: "https://robot.test" });
  fed.setActorDispatcher("/users/{identifier}", async () => null);
  const ctx = fed.createContext(new URL("https://robot.test"), undefined);
  const config = parseConfig(`
bots:
  still_here:
    feed_url: https://example.com/rss
    display_name: Still here
    summary: Kept.
`);

  beforeAll(() => migrate(db));
  beforeEach(async () => {
    for (const bot of ["gone_bot", "lease_bot"]) {
      await db.delete(actorKeypairs).where(eq(actorKeypairs.botUsername, bot));
      await db.delete(followers).where(eq(followers.botUsername, bot));
      await db.delete(feedPollStatus).where(eq(feedPollStatus.botUsername, bot));
    }
    ctx.reset();
    vi.restoreAllMocks();
  });
  afterAll(() => client.end());

  async function removedBotWithFollower() {
    const pair = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
    await saveKeypairs(db, "gone_bot", [{ publicKey: await exportJwk(pair.publicKey), privateKey: await exportJwk(pair.privateKey) }]);
    await addFollower(db, "gone_bot", "https://remote.example/a", "https://remote.example/f", "https://remote.example/inbox");
  }

  it("keeps a removed bot's keys and followers when its Delete cannot be queued", async () => {
    await removedBotWithFollower();
    vi.spyOn(ctx, "sendActivity").mockRejectedValueOnce(new Error("queue down"));
    await expect(sendDeletedBotActivities(ctx, db, config)).rejects.toThrow(/gone_bot/);
    expect(await getAllBotUsernames(db)).toContain("gone_bot");
    expect(await getFollowers(db, "gone_bot")).toHaveLength(1);
  });

  it("cleans up once the Delete is queued, with a stable activity id", async () => {
    await removedBotWithFollower();
    await sendDeletedBotActivities(ctx, db, config);
    expect(ctx.getSentActivities()[0].activity.id?.href).toBe("https://robot.test/users/gone_bot#delete");
    expect(await getAllBotUsernames(db)).not.toContain("gone_bot");
  });

  it("gives a feed to exactly one replica until its lease is released or expires", async () => {
    const now = new Date();
    const claims = await Promise.all([1, 2, 3].map(() => claimFeedPoll(db, "lease_bot", now, 60_000)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await claimFeedPoll(db, "lease_bot", new Date(now.getTime() + 61_000), 60_000)).toBe(true);
    await releaseFeedPoll(db, "lease_bot");
    expect(await claimFeedPoll(db, "lease_bot", now, 60_000)).toBe(true);
  });

  it("records the last success and keeps it through later failures", async () => {
    const ok = new Date("2026-01-01T00:00:00Z");
    const base = { botUsername: "lease_bot", lastHttpStatus: 200, etag: null, lastModified: null, nextPollAt: null };
    await upsertFeedPollStatus(db, { ...base, lastCheckedAt: ok, lastError: null });
    await upsertFeedPollStatus(db, { ...base, lastCheckedAt: new Date(), lastError: "HTTP 500" });
    const [row] = await db.select().from(feedPollStatus).where(eq(feedPollStatus.botUsername, "lease_bot"));
    expect(row.lastSuccessAt?.toISOString()).toBe(ok.toISOString());
    expect(row.claimedUntil).toBeNull();
  });
});
