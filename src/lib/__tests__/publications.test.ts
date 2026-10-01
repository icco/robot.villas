import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { createFederation } from "@fedify/testing";
import { createDb, migrate } from "../db";
import { getPublicationSummary, prunePublications, storeEntryWithPublications, submitPendingPublications } from "../publications";
import { feedEntries, publications } from "../schema";

describe.skipIf(!process.env.DATABASE_URL)("durable publication", () => {
  const client = postgres(process.env.DATABASE_URL ?? "postgres://unused");
  const db = createDb(client);
  const bot = "publication_test";
  const recipients = ["one.example", "two.example"].map((host) => ({ id: new URL(`https://${host}/actor`), inboxId: new URL(`https://${host}/inbox`), endpoints: null }));
  const fed = createFederation<void>();
  const ctx = fed.createContext(new URL("https://robot.test"), undefined);
  beforeAll(() => migrate(db));
  beforeEach(async () => {
    const entries = await db.select().from(feedEntries).where(eq(feedEntries.botUsername, bot));
    for (const entry of entries) {
      await db.delete(publications).where(eq(publications.entryId, entry.id));
    }
    await db.delete(feedEntries).where(eq(feedEntries.botUsername, bot));
    ctx.reset();
    vi.restoreAllMocks();
  });
  afterAll(() => client.end());
  const store = () => storeEntryWithPublications(db, bot, "guid", "https://example.com", "title", null, [], recipients);

  it("commits post and destination intent together, even before a worker runs", async () => {
    const id = await store();
    expect(await store()).toBeNull();
    expect(await db.select().from(publications).where(eq(publications.entryId, id!))).toHaveLength(2);
    expect(ctx.getSentActivities()).toHaveLength(0);
    await submitPendingPublications(ctx, db, "robot.test", [bot]);
    expect(ctx.getSentActivities()).toHaveLength(2);
  });

  it("retries only a failed destination after a partial enqueue", async () => {
    const id = await store();
    const original = ctx.sendActivity.bind(ctx);
    vi.spyOn(ctx, "sendActivity").mockRejectedValueOnce(new Error("queue unavailable")).mockImplementation(original);
    expect(await submitPendingPublications(ctx, db, "robot.test", [bot])).toMatchObject({ queued: 1, failed: 1 });
    const first = ctx.getSentActivities()[0].activity.id?.href;
    expect(await submitPendingPublications(ctx, db, "robot.test", [bot], new Set(), new Date(Date.now() + 60_000))).toMatchObject({ queued: 1, failed: 0 });
    expect(ctx.getSentActivities()[1].activity.id?.href).toBe(first);
    const rows = await db.select().from(publications).where(eq(publications.entryId, id!));
    expect(rows.every((r) => r.queuedAt != null)).toBe(true);
    expect(rows.map((r) => r.attempts).sort()).toEqual([1, 2]);
  });

  it("survives the crash window after enqueue using the same activity identity", async () => {
    await store();
    const original = ctx.sendActivity.bind(ctx);
    vi.spyOn(ctx, "sendActivity").mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error("connection lost after enqueue");
    }).mockImplementation(original);
    await submitPendingPublications(ctx, db, "robot.test", [bot]);
    await submitPendingPublications(ctx, db, "robot.test", [bot], new Set(), new Date(Date.now() + 60_000));
    expect(new Set(ctx.getSentActivities().map((a) => a.activity.id?.href)).size).toBe(1);
  });

  it("resends a revived entry instead of failing on its old intent", async () => {
    const id = await store();
    await submitPendingPublications(ctx, db, "robot.test", [bot]);
    await db.update(feedEntries).set({ deletedAt: new Date() }).where(eq(feedEntries.id, id!));
    expect(await store()).toBe(id);
    const rows = await db.select().from(publications).where(eq(publications.entryId, id!));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.queuedAt == null && r.attempts === 0)).toBe(true);
  });

  it("summarizes the backlog and prunes only old finished rows", async () => {
    const id = await store();
    let summary = await getPublicationSummary(db);
    expect(summary.pending).toBeGreaterThanOrEqual(2);
    await submitPendingPublications(ctx, db, "robot.test", [bot]);
    summary = await getPublicationSummary(db);
    expect(summary.queuedLastDay).toBeGreaterThanOrEqual(2);
    expect(await prunePublications(db)).toBe(0);
    await prunePublications(db, new Date(Date.now() + 31 * 86_400_000));
    expect(await db.select().from(publications).where(eq(publications.entryId, id!))).toHaveLength(0);
  });

  it("prevents concurrent workers from submitting the same destination and honors new blocks", async () => {
    await store();
    await Promise.all([
      submitPendingPublications(ctx, db, "robot.test", [bot], new Set(["two.example"])),
      submitPendingPublications(ctx, db, "robot.test", [bot], new Set(["two.example"])),
    ]);
    expect(ctx.getSentActivities()).toHaveLength(1);
  });
});
