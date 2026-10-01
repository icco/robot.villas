import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./db";
import { feedEntries, reactions, following, relays } from "./schema";

/** Authentication establishes the sender; the stored target authorizes this transition. */
export async function receiveFollowResponse(db: Db, followId: string, actorId: string, status: "accepted" | "rejected") {
  await db.transaction(async (tx) => {
    await tx.update(following).set({ status, statusChangedAt: new Date() }).where(and(
      eq(following.followActivityId, followId), eq(following.targetActorId, actorId),
      eq(following.status, "pending"), isNull(following.deletedAt),
    ));
    await tx.update(relays).set({ status, statusChangedAt: new Date() }).where(and(
      eq(relays.followActivityId, followId), eq(relays.actorId, actorId),
      eq(relays.status, "pending"), isNull(relays.deletedAt),
    ));
  });
}

export interface ReactionInput {
  activityId: string;
  actorId: string;
  botUsername: string;
  entryId: number;
  kind: "like" | "boost" | "emoji";
  content: string;
}

export async function receiveReaction(db: Db, reaction: ReactionInput, undo = false): Promise<void> {
  await db.transaction(async (tx) => {
    // Serializes reactions and Undo for this post, including Undo-before-Create.
    const [entry] = await tx.select({ id: feedEntries.id }).from(feedEntries).where(and(
      eq(feedEntries.id, reaction.entryId), eq(feedEntries.botUsername, reaction.botUsername), isNull(feedEntries.deletedAt),
    )).for("update");
    if (!entry) {
      return;
    }
    const values = { activityId: reaction.activityId, actorId: reaction.actorId, entryId: reaction.entryId, kind: reaction.kind, content: reaction.content };
    const column = reaction.kind === "boost" ? feedEntries.boostCount : feedEntries.likeCount;
    let delta: number;
    if (undo) {
      const changed = await tx.update(reactions).set({ undoneAt: new Date() }).where(and(
        eq(reactions.activityId, reaction.activityId), eq(reactions.actorId, reaction.actorId),
        eq(reactions.entryId, reaction.entryId), eq(reactions.kind, reaction.kind), isNull(reactions.undoneAt),
      )).returning();
      delta = changed.length ? -1 : 0;
      await tx.insert(reactions).values({ ...values, undoneAt: new Date() }).onConflictDoNothing();
    } else {
      const inserted = await tx.insert(reactions).values(values).onConflictDoNothing().returning();
      delta = inserted.length ? 1 : 0;
    }
    if (delta) {
      await tx.update(feedEntries).set({
        [reaction.kind === "boost" ? "boostCount" : "likeCount"]: sql`GREATEST(${column} + ${delta}, 0)`,
      }).where(eq(feedEntries.id, entry.id));
    }
  });
}
