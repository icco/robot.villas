import type { Context } from "@fedify/fedify";
import type { Recipient } from "@fedify/vocab";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { insertEntry, type Db } from "./db";
import { feedEntries, publications } from "./schema";
import { buildCreateActivity } from "./publisher";
import { partitionBlockedRecipients } from "./blocklist";

export async function storeEntryWithPublications(
  db: Db, bot: string, guid: string, url: string, title: string,
  publishedAt: Date | null, hashtags: string[], recipients: Recipient[],
): Promise<number | null> {
  return db.transaction(async (tx) => {
    const id = await insertEntry(tx, bot, guid, url, title, publishedAt, hashtags);
    if (id == null) {
      return null;
    }
    const destinations = new Map(recipients.filter((r) => r.id && r.inboxId).map((r) => [r.inboxId!.href, r]));
    if (destinations.size) {
      await tx.insert(publications).values([...destinations.values()].map((r) => ({
        entryId: id, actorId: r.id!.href, inboxUrl: r.inboxId!.href,
      })));
    }
    return id;
  });
}

/**
 * At-least-once queue submission: a crash after enqueue can replay the SAME
 * activity ID. The post and destination intent are never lost in that window.
 * Workers lock individual rows so concurrent workers skip already claimed work.
 */
export async function submitPendingPublications(
  ctx: Context<void>, db: Db, domain: string, bots: string[],
  blocked: ReadonlySet<string> = new Set(), now = new Date(),
) {
  const due = and(isNull(publications.queuedAt), isNull(publications.cancelledAt), lte(publications.nextAttemptAt, now));
  const candidates = await db.select({ id: publications.id }).from(publications).where(due)
    .orderBy(asc(publications.nextAttemptAt), asc(publications.id)).limit(100);
  const result = { queued: 0, failed: 0, cancelled: 0 };
  for (const candidate of candidates) {
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(publications).where(and(eq(publications.id, candidate.id), due))
        .for("update", { skipLocked: true });
      if (!row) {
        return;
      }
      const [entry] = await tx.select().from(feedEntries).where(eq(feedEntries.id, row.entryId));
      const recipient = { id: new URL(row.actorId), inboxId: new URL(row.inboxUrl), endpoints: null };
      if (!entry || entry.deletedAt || !bots.includes(entry.botUsername) || partitionBlockedRecipients([recipient], blocked).allowed.length === 0) {
        await tx.update(publications).set({ cancelledAt: now }).where(eq(publications.id, row.id));
        result.cancelled++;
        return;
      }
      try {
        const activity = buildCreateActivity(entry.botUsername, entry.id, {
          title: entry.title, link: entry.url, publishedAt: entry.publishedAt, hashtags: entry.hashtags,
        }, `https://${domain}`);
        await ctx.sendActivity({ identifier: entry.botUsername }, recipient, activity);
        await tx.update(publications).set({ queuedAt: now, lastError: null, attempts: row.attempts + 1 }).where(eq(publications.id, row.id));
        result.queued++;
      } catch (error) {
        await tx.update(publications).set({
          attempts: row.attempts + 1,
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          nextAttemptAt: new Date(now.getTime() + Math.min(3_600_000, 30_000 * 2 ** Math.min(row.attempts, 7))),
        }).where(eq(publications.id, row.id));
        result.failed++;
      }
    });
  }
  return result;
}
