import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as runMigrations } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";
import type { FeedEntry } from "./feed-entry";
import { MAX_TAGS } from "./hashtags";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

export function createDb(client: postgres.Sql) {
  return drizzle({ client, schema });
}

export async function migrate(db: Db): Promise<void> {
  await runMigrations(db, { migrationsFolder: "./drizzle" });
}

export async function hasEntry(db: Db, botUsername: string, guid: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.feedEntries.id })
    .from(schema.feedEntries)
    .where(and(eq(schema.feedEntries.botUsername, botUsername), eq(schema.feedEntries.guid, guid), isNull(schema.feedEntries.deletedAt)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Inserts a feed entry. Returns the new row id when inserted, or null when the
 * entry already existed (dedup by bot + guid). Use the returned id for Note URIs.
 */
export async function insertEntry(
  db: Db,
  botUsername: string,
  guid: string,
  url: string,
  title: string,
  publishedAt: Date | null,
  hashtags: string[],
): Promise<number | null> {
  if (hashtags.length > MAX_TAGS) {
    throw new Error(`insertEntry: at most ${MAX_TAGS} hashtags`);
  }
  const rows = await db
    .insert(schema.feedEntries)
    .values({ botUsername, guid, url, title, publishedAt, hashtags })
    .onConflictDoUpdate({
      target: [schema.feedEntries.botUsername, schema.feedEntries.guid],
      set: { deletedAt: null },
      where: isNotNull(schema.feedEntries.deletedAt),
    })
    .returning({ id: schema.feedEntries.id });
  return rows[0]?.id ?? null;
}

export async function countFollowers(db: Db, botUsername: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(schema.followers)
    .where(and(eq(schema.followers.botUsername, botUsername), isNull(schema.followers.deletedAt)));
  return rows[0]?.value ?? 0;
}

export interface FollowerRow {
  followerId: string;
  sharedInboxUrl: string | null;
}

export async function getFollowers(db: Db, botUsername: string): Promise<string[]> {
  const rows = await db
    .select({ followerId: schema.followers.followerId })
    .from(schema.followers)
    .where(and(eq(schema.followers.botUsername, botUsername), isNull(schema.followers.deletedAt)));
  return rows.map((r) => r.followerId);
}

export async function getFollowerRecipients(db: Db, botUsername: string): Promise<FollowerRow[]> {
  return db
    .select({
      followerId: schema.followers.followerId,
      sharedInboxUrl: schema.followers.sharedInboxUrl,
    })
    .from(schema.followers)
    .where(and(eq(schema.followers.botUsername, botUsername), isNull(schema.followers.deletedAt)));
}

export async function addFollower(
  db: Db,
  botUsername: string,
  followerId: string,
  followId: string,
  sharedInboxUrl: string | null = null,
): Promise<void> {
  await db
    .insert(schema.followers)
    .values({ botUsername, followerId, followId, sharedInboxUrl })
    .onConflictDoUpdate({
      target: [schema.followers.botUsername, schema.followers.followerId],
      set: { followId, sharedInboxUrl, deletedAt: null },
    });
}

export async function removeFollower(db: Db, botUsername: string, followerId: string): Promise<void> {
  await db
    .update(schema.followers)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.followers.botUsername, botUsername), eq(schema.followers.followerId, followerId), isNull(schema.followers.deletedAt)));
}

export async function getFollowersWithNullInbox(db: Db): Promise<{ followerId: string }[]> {
  return db
    .selectDistinct({ followerId: schema.followers.followerId })
    .from(schema.followers)
    .where(and(isNull(schema.followers.sharedInboxUrl), isNull(schema.followers.deletedAt)));
}

export async function updateFollowerInboxUrl(db: Db, followerId: string, sharedInboxUrl: string): Promise<void> {
  await db
    .update(schema.followers)
    .set({ sharedInboxUrl })
    .where(and(eq(schema.followers.followerId, followerId), isNull(schema.followers.deletedAt)));
}

export async function removeFollowerFromAll(db: Db, followerId: string): Promise<number> {
  const rows = await db
    .update(schema.followers)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.followers.followerId, followerId), isNull(schema.followers.deletedAt)))
    .returning({ id: schema.followers.id });
  return rows.length;
}

export async function incrementLikeCount(db: Db, botUsername: string, entryId: number): Promise<void> {
  await db
    .update(schema.feedEntries)
    .set({ likeCount: sql`${schema.feedEntries.likeCount} + 1` })
    .where(and(eq(schema.feedEntries.botUsername, botUsername), eq(schema.feedEntries.id, entryId), isNull(schema.feedEntries.deletedAt)));
}

export async function incrementBoostCount(db: Db, botUsername: string, entryId: number): Promise<void> {
  await db
    .update(schema.feedEntries)
    .set({ boostCount: sql`${schema.feedEntries.boostCount} + 1` })
    .where(and(eq(schema.feedEntries.botUsername, botUsername), eq(schema.feedEntries.id, entryId), isNull(schema.feedEntries.deletedAt)));
}

export async function decrementLikeCount(db: Db, botUsername: string, entryId: number): Promise<void> {
  await db
    .update(schema.feedEntries)
    .set({ likeCount: sql`GREATEST(${schema.feedEntries.likeCount} - 1, 0)` })
    .where(and(eq(schema.feedEntries.botUsername, botUsername), eq(schema.feedEntries.id, entryId), isNull(schema.feedEntries.deletedAt)));
}

export async function decrementBoostCount(db: Db, botUsername: string, entryId: number): Promise<void> {
  await db
    .update(schema.feedEntries)
    .set({ boostCount: sql`GREATEST(${schema.feedEntries.boostCount} - 1, 0)` })
    .where(and(eq(schema.feedEntries.botUsername, botUsername), eq(schema.feedEntries.id, entryId), isNull(schema.feedEntries.deletedAt)));
}

export async function countEntries(db: Db, botUsername: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(schema.feedEntries)
    .where(and(eq(schema.feedEntries.botUsername, botUsername), isNull(schema.feedEntries.deletedAt)));
  return rows[0]?.value ?? 0;
}

export async function getEntryById(
  db: Db,
  botUsername: string,
  entryId: number,
): Promise<{ id: number; url: string; title: string; publishedAt: Date | null; hashtags: string[] } | null> {
  const rows = await db
    .select({
      id: schema.feedEntries.id,
      url: schema.feedEntries.url,
      title: schema.feedEntries.title,
      publishedAt: schema.feedEntries.publishedAt,
      hashtags: schema.feedEntries.hashtags,
    })
    .from(schema.feedEntries)
    .where(and(eq(schema.feedEntries.botUsername, botUsername), eq(schema.feedEntries.id, entryId), isNull(schema.feedEntries.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getEntriesPage(
  db: Db,
  botUsername: string,
  limit: number,
  offset: number,
): Promise<FeedEntry[]> {
  return db
    .select({
      id: schema.feedEntries.id,
      botUsername: schema.feedEntries.botUsername,
      url: schema.feedEntries.url,
      title: schema.feedEntries.title,
      publishedAt: schema.feedEntries.publishedAt,
      likeCount: schema.feedEntries.likeCount,
      boostCount: schema.feedEntries.boostCount,
      hashtags: schema.feedEntries.hashtags,
    })
    .from(schema.feedEntries)
    .where(and(eq(schema.feedEntries.botUsername, botUsername), isNull(schema.feedEntries.deletedAt)))
    .orderBy(desc(schema.feedEntries.publishedAt))
    .limit(limit)
    .offset(offset);
}

const TAG_ENTRY_FIELDS = {
  id: schema.feedEntries.id,
  botUsername: schema.feedEntries.botUsername,
  url: schema.feedEntries.url,
  title: schema.feedEntries.title,
  publishedAt: schema.feedEntries.publishedAt,
  likeCount: schema.feedEntries.likeCount,
  boostCount: schema.feedEntries.boostCount,
  hashtags: schema.feedEntries.hashtags,
};

/**
 * Case-insensitive tag match using a JSONB array-element scan.
 * Normalises both stored tags and the query to lower-case so
 * "#Synthesizers" and "#synthesizers" resolve to the same page.
 */
function tagFilter(tag: string) {
  return sql`EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(${schema.feedEntries.hashtags}) AS t(v)
    WHERE lower(t.v) = lower(${tag})
  )`;
}

export async function getEntriesByTag(
  db: Db,
  tag: string,
  limit: number,
  offset: number,
): Promise<FeedEntry[]> {
  return db
    .select(TAG_ENTRY_FIELDS)
    .from(schema.feedEntries)
    .where(and(tagFilter(tag), isNull(schema.feedEntries.deletedAt)))
    .orderBy(desc(schema.feedEntries.publishedAt))
    .limit(limit)
    .offset(offset);
}

export async function countEntriesByTag(db: Db, tag: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(schema.feedEntries)
    .where(and(tagFilter(tag), isNull(schema.feedEntries.deletedAt)));
  return rows[0]?.value ?? 0;
}

export async function getAllEntries(
  db: Db,
  limit: number,
  offset: number,
): Promise<FeedEntry[]> {
  return db
    .select(TAG_ENTRY_FIELDS)
    .from(schema.feedEntries)
    .where(isNull(schema.feedEntries.deletedAt))
    .orderBy(desc(schema.feedEntries.publishedAt))
    .limit(limit)
    .offset(offset);
}

export async function countAllEntries(db: Db): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(schema.feedEntries)
    .where(isNull(schema.feedEntries.deletedAt));
  return rows[0]?.value ?? 0;
}

export async function getAllTags(db: Db): Promise<Array<{ tag: string; postCount: number }>> {
  const result = await db.execute<{ tag: string; post_count: number }>(sql`
    SELECT lower(t.v) AS tag, count(*)::int AS post_count
    FROM ${schema.feedEntries},
         jsonb_array_elements_text(${schema.feedEntries.hashtags}) AS t(v)
    WHERE ${schema.feedEntries.deletedAt} IS NULL
    GROUP BY lower(t.v)
    ORDER BY count(*) DESC
  `);
  return result.map((r) => ({ tag: r.tag, postCount: r.post_count }));
}

/**
 * Returns stored key pairs for a bot. Handles both the legacy single-JWK
 * format and the new array-of-JWKs format (for dual RSA + Ed25519 keys).
 */
export async function getKeypairs(
  db: Db,
  botUsername: string,
): Promise<Array<{ publicKey: JsonWebKey; privateKey: JsonWebKey }> | null> {
  const rows = await db
    .select({
      publicKey: schema.actorKeypairs.publicKey,
      privateKey: schema.actorKeypairs.privateKey,
    })
    .from(schema.actorKeypairs)
    .where(and(eq(schema.actorKeypairs.botUsername, botUsername), isNull(schema.actorKeypairs.deletedAt)));
  if (rows.length === 0) {
    return null;
  }
  const pubRaw = rows[0].publicKey;
  const privRaw = rows[0].privateKey;
  const pubs = Array.isArray(pubRaw) ? pubRaw : [pubRaw];
  const privs = Array.isArray(privRaw) ? privRaw : [privRaw];
  return pubs.map((pub: unknown, i: number) => ({
    publicKey: pub as JsonWebKey,
    privateKey: privs[i] as JsonWebKey,
  }));
}

/**
 * Saves key pairs for a bot, upserting so that Ed25519 keys can be added
 * alongside existing RSA keys without losing them.
 */
export async function saveKeypairs(
  db: Db,
  botUsername: string,
  keypairs: Array<{ publicKey: JsonWebKey; privateKey: JsonWebKey }>,
): Promise<void> {
  const publicKey = keypairs.map((kp) => kp.publicKey);
  const privateKey = keypairs.map((kp) => kp.privateKey);
  await db
    .insert(schema.actorKeypairs)
    .values({ botUsername, publicKey, privateKey })
    .onConflictDoUpdate({
      target: schema.actorKeypairs.botUsername,
      set: { publicKey, privateKey, deletedAt: null },
    });
}

export async function getAllBotUsernames(db: Db): Promise<string[]> {
  const rows = await db
    .select({ botUsername: schema.actorKeypairs.botUsername })
    .from(schema.actorKeypairs)
    .where(isNull(schema.actorKeypairs.deletedAt));
  return rows.map((r) => r.botUsername);
}

export async function removeKeypairs(db: Db, botUsername: string): Promise<void> {
  await db
    .update(schema.actorKeypairs)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.actorKeypairs.botUsername, botUsername), isNull(schema.actorKeypairs.deletedAt)));
}

export async function removeAllFollowers(db: Db, botUsername: string): Promise<void> {
  await db
    .update(schema.followers)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.followers.botUsername, botUsername), isNull(schema.followers.deletedAt)));
}

export async function removeAllEntries(db: Db, botUsername: string): Promise<void> {
  await db
    .update(schema.feedEntries)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.feedEntries.botUsername, botUsername), isNull(schema.feedEntries.deletedAt)));
}

export async function removeAllFollowing(db: Db, botUsername: string): Promise<void> {
  await db
    .update(schema.following)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.following.botUsername, botUsername), isNull(schema.following.deletedAt)));
}

// --- Stats functions ---

export interface BotStats {
  botUsername: string;
  postCount: number;
  followerCount: number;
  totalLikes: number;
  totalBoosts: number;
  latestPostAt: Date | null;
}

export async function getGlobalStats(db: Db): Promise<{
  totalPosts: number;
  totalFollowers: number;
  totalLikes: number;
  totalBoosts: number;
}> {
  const [postStats] = await db
    .select({
      totalPosts: count(),
      totalLikes: sql<number>`coalesce(sum(${schema.feedEntries.likeCount}), 0)`,
      totalBoosts: sql<number>`coalesce(sum(${schema.feedEntries.boostCount}), 0)`,
    })
    .from(schema.feedEntries)
    .where(isNull(schema.feedEntries.deletedAt));
  const [followerStats] = await db
    .select({ totalFollowers: count() })
    .from(schema.followers)
    .where(isNull(schema.followers.deletedAt));
  return {
    totalPosts: postStats.totalPosts,
    totalFollowers: followerStats.totalFollowers,
    totalLikes: Number(postStats.totalLikes),
    totalBoosts: Number(postStats.totalBoosts),
  };
}

export async function getPerBotStats(db: Db): Promise<BotStats[]> {
  const postStats = await db
    .select({
      botUsername: schema.feedEntries.botUsername,
      postCount: count(),
      totalLikes: sql<number>`coalesce(sum(${schema.feedEntries.likeCount}), 0)`,
      totalBoosts: sql<number>`coalesce(sum(${schema.feedEntries.boostCount}), 0)`,
      latestPostAt: sql<Date | null>`max(${schema.feedEntries.publishedAt})`,
    })
    .from(schema.feedEntries)
    .where(isNull(schema.feedEntries.deletedAt))
    .groupBy(schema.feedEntries.botUsername);

  const followerCounts = await db
    .select({
      botUsername: schema.followers.botUsername,
      followerCount: count(),
    })
    .from(schema.followers)
    .where(isNull(schema.followers.deletedAt))
    .groupBy(schema.followers.botUsername);

  const followerMap = new Map(followerCounts.map((r) => [r.botUsername, r.followerCount]));

  return postStats.map((r) => ({
    botUsername: r.botUsername,
    postCount: r.postCount,
    followerCount: followerMap.get(r.botUsername) ?? 0,
    totalLikes: Number(r.totalLikes),
    totalBoosts: Number(r.totalBoosts),
    latestPostAt: r.latestPostAt,
  }));
}

export async function getTopPosts(db: Db, limit: number): Promise<FeedEntry[]> {
  return db
    .select({
      id: schema.feedEntries.id,
      botUsername: schema.feedEntries.botUsername,
      title: schema.feedEntries.title,
      url: schema.feedEntries.url,
      likeCount: schema.feedEntries.likeCount,
      boostCount: schema.feedEntries.boostCount,
      publishedAt: schema.feedEntries.publishedAt,
      hashtags: schema.feedEntries.hashtags,
    })
    .from(schema.feedEntries)
    .where(isNull(schema.feedEntries.deletedAt))
    .orderBy(desc(sql`${schema.feedEntries.likeCount} + ${schema.feedEntries.boostCount}`))
    .limit(limit);
}

// --- Relay functions ---

export interface RelayRow {
  id: number;
  botUsername: string;
  url: string;
  inboxUrl: string | null;
  actorId: string | null;
  status: "pending" | "accepted" | "rejected";
  followActivityId: string | null;
}

export async function getAcceptedRelays(db: Db): Promise<RelayRow[]> {
  const rows = await db
    .select({
      id: schema.relays.id,
      botUsername: schema.relays.botUsername,
      url: schema.relays.url,
      inboxUrl: schema.relays.inboxUrl,
      actorId: schema.relays.actorId,
      status: schema.relays.status,
      followActivityId: schema.relays.followActivityId,
    })
    .from(schema.relays)
    .where(and(eq(schema.relays.status, "accepted"), isNull(schema.relays.deletedAt)));
  // Deduplicate by inboxUrl so we don't deliver to the same relay inbox more than once.
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r.inboxUrl) {
      return false;
    }
    if (seen.has(r.inboxUrl)) {
      return false;
    }
    seen.add(r.inboxUrl);
    return true;
  });
}

export async function getAllRelays(db: Db, botUsername?: string): Promise<RelayRow[]> {
  const conditions = [isNull(schema.relays.deletedAt)];
  if (botUsername !== undefined) {
    conditions.push(eq(schema.relays.botUsername, botUsername));
  }
  return db
    .select({
      id: schema.relays.id,
      botUsername: schema.relays.botUsername,
      url: schema.relays.url,
      inboxUrl: schema.relays.inboxUrl,
      actorId: schema.relays.actorId,
      status: schema.relays.status,
      followActivityId: schema.relays.followActivityId,
    })
    .from(schema.relays)
    .where(and(...conditions));
}

export async function upsertRelay(
  db: Db,
  botUsername: string,
  url: string,
  inboxUrl: string | null,
  actorId: string | null,
  followActivityId: string | null,
): Promise<void> {
  await db
    .insert(schema.relays)
    .values({ botUsername, url, inboxUrl, actorId, followActivityId, status: "pending" })
    .onConflictDoUpdate({
      target: [schema.relays.botUsername, schema.relays.url],
      set: { inboxUrl, actorId, followActivityId, status: "pending" as const, deletedAt: null },
    });
}

export async function getRelayByActivityId(db: Db, followActivityId: string): Promise<RelayRow | null> {
  const rows = await db
    .select({
      id: schema.relays.id,
      botUsername: schema.relays.botUsername,
      url: schema.relays.url,
      inboxUrl: schema.relays.inboxUrl,
      actorId: schema.relays.actorId,
      status: schema.relays.status,
      followActivityId: schema.relays.followActivityId,
    })
    .from(schema.relays)
    .where(and(eq(schema.relays.followActivityId, followActivityId), isNull(schema.relays.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateRelayStatus(
  db: Db,
  followActivityId: string,
  status: "accepted" | "rejected",
): Promise<void> {
  await db
    .update(schema.relays)
    .set({ status })
    .where(eq(schema.relays.followActivityId, followActivityId));
}

export async function removeRelay(db: Db, botUsername: string, url: string): Promise<void> {
  await db
    .update(schema.relays)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.relays.botUsername, botUsername), eq(schema.relays.url, url), isNull(schema.relays.deletedAt)));
}

// --- Status summary functions ---

export interface RelayStatusSummary {
  url: string;
  pending: number;
  accepted: number;
  rejected: number;
}

/**
 * Returns a per-relay-URL summary of how many bots are in each subscription status.
 */
export async function getRelayStatusSummary(db: Db): Promise<RelayStatusSummary[]> {
  const rows = await getAllRelays(db);
  const map = new Map<string, RelayStatusSummary>();
  for (const row of rows) {
    const existing = map.get(row.url) ?? { url: row.url, pending: 0, accepted: 0, rejected: 0 };
    if (row.status === "accepted") {
      existing.accepted++;
    } else if (row.status === "rejected") {
      existing.rejected++;
    } else {
      existing.pending++;
    }
    map.set(row.url, existing);
  }
  return [...map.values()];
}

export interface FollowingStatusSummary {
  handle: string;
  pending: number;
  accepted: number;
  rejected: number;
}

/**
 * Returns a per-handle summary of how many bots are in each follow status.
 */
export async function getFollowingStatusSummary(db: Db): Promise<FollowingStatusSummary[]> {
  const rows = await getAllFollowing(db);
  const map = new Map<string, FollowingStatusSummary>();
  for (const row of rows) {
    const existing = map.get(row.handle) ?? { handle: row.handle, pending: 0, accepted: 0, rejected: 0 };
    if (row.status === "accepted") {
      existing.accepted++;
    } else if (row.status === "rejected") {
      existing.rejected++;
    } else {
      existing.pending++;
    }
    map.set(row.handle, existing);
  }
  return [...map.values()];
}

// --- Following functions ---

export interface FollowingRow {
  botUsername: string;
  handle: string;
  targetActorId: string | null;
  followActivityId: string | null;
  status: string;
}

export async function getAllFollowing(db: Db): Promise<FollowingRow[]> {
  return db
    .select({
      botUsername: schema.following.botUsername,
      handle: schema.following.handle,
      targetActorId: schema.following.targetActorId,
      followActivityId: schema.following.followActivityId,
      status: schema.following.status,
    })
    .from(schema.following)
    .where(isNull(schema.following.deletedAt));
}

export async function upsertFollowing(
  db: Db,
  botUsername: string,
  handle: string,
  targetActorId: string | null,
  followActivityId: string | null,
): Promise<void> {
  await db
    .insert(schema.following)
    .values({ botUsername, handle, targetActorId, followActivityId, status: "pending" })
    .onConflictDoUpdate({
      target: [schema.following.botUsername, schema.following.handle],
      set: { targetActorId, followActivityId, status: "pending", deletedAt: null },
    });
}

export async function updateFollowingStatus(
  db: Db,
  followActivityId: string,
  status: "accepted" | "rejected",
): Promise<void> {
  await db
    .update(schema.following)
    .set({ status })
    .where(eq(schema.following.followActivityId, followActivityId));
}

export async function getFollowingByActivityId(
  db: Db,
  followActivityId: string,
): Promise<FollowingRow | null> {
  const rows = await db
    .select({
      botUsername: schema.following.botUsername,
      handle: schema.following.handle,
      targetActorId: schema.following.targetActorId,
      followActivityId: schema.following.followActivityId,
      status: schema.following.status,
    })
    .from(schema.following)
    .where(and(eq(schema.following.followActivityId, followActivityId), isNull(schema.following.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function countAcceptedFollowing(db: Db, botUsername: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(schema.following)
    .where(
      and(
        eq(schema.following.botUsername, botUsername),
        eq(schema.following.status, "accepted"),
        isNull(schema.following.deletedAt),
        isNotNull(schema.following.targetActorId),
      ),
    );
  return rows[0]?.value ?? 0;
}

export async function getAcceptedFollowingActorIds(db: Db, botUsername: string): Promise<string[]> {
  const rows = await db
    .select({ targetActorId: schema.following.targetActorId })
    .from(schema.following)
    .where(
      and(
        eq(schema.following.botUsername, botUsername),
        eq(schema.following.status, "accepted"),
        isNull(schema.following.deletedAt),
        isNotNull(schema.following.targetActorId),
      ),
    )
    .orderBy(asc(schema.following.handle));
  return rows.map((r) => r.targetActorId!);
}

export interface FollowingListItem {
  handle: string;
  targetActorId: string | null;
  status: string;
}

export async function getFollowingListForBot(db: Db, botUsername: string): Promise<FollowingListItem[]> {
  return db
    .select({
      handle: schema.following.handle,
      targetActorId: schema.following.targetActorId,
      status: schema.following.status,
    })
    .from(schema.following)
    .where(and(eq(schema.following.botUsername, botUsername), isNull(schema.following.deletedAt)))
    .orderBy(asc(schema.following.handle));
}

// --- RSS feed poll status ---

export interface FeedPollStatusRow {
  botUsername: string;
  lastCheckedAt: Date;
  lastHttpStatus: number | null;
  lastError: string | null;
}

export async function upsertFeedPollStatus(
  db: Db,
  botUsername: string,
  lastCheckedAt: Date,
  lastHttpStatus: number | null,
  lastError: string | null,
): Promise<void> {
  await db
    .insert(schema.feedPollStatus)
    .values({ botUsername, lastCheckedAt, lastHttpStatus, lastError })
    .onConflictDoUpdate({
      target: schema.feedPollStatus.botUsername,
      set: { lastCheckedAt, lastHttpStatus, lastError },
    });
}

export async function getFeedPollStatusMap(
  db: Db,
  botUsernames: string[],
): Promise<Map<string, FeedPollStatusRow>> {
  if (botUsernames.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      botUsername: schema.feedPollStatus.botUsername,
      lastCheckedAt: schema.feedPollStatus.lastCheckedAt,
      lastHttpStatus: schema.feedPollStatus.lastHttpStatus,
      lastError: schema.feedPollStatus.lastError,
    })
    .from(schema.feedPollStatus)
    .where(inArray(schema.feedPollStatus.botUsername, botUsernames));
  return new Map(rows.map((r) => [r.botUsername, r]));
}
