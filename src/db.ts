import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as runMigrations } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";
import * as schema from "./schema.js";

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
): Promise<number | null> {
  const rows = await db
    .insert(schema.feedEntries)
    .values({ botUsername, guid, url, title, publishedAt })
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
): Promise<{ id: number; url: string; title: string; publishedAt: Date | null } | null> {
  const rows = await db
    .select({
      id: schema.feedEntries.id,
      url: schema.feedEntries.url,
      title: schema.feedEntries.title,
      publishedAt: schema.feedEntries.publishedAt,
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
): Promise<
  Array<{ id: number; url: string; title: string; publishedAt: Date | null; likeCount: number; boostCount: number }>
> {
  return db
    .select({
      id: schema.feedEntries.id,
      url: schema.feedEntries.url,
      title: schema.feedEntries.title,
      publishedAt: schema.feedEntries.publishedAt,
      likeCount: schema.feedEntries.likeCount,
      boostCount: schema.feedEntries.boostCount,
    })
    .from(schema.feedEntries)
    .where(and(eq(schema.feedEntries.botUsername, botUsername), isNull(schema.feedEntries.deletedAt)))
    .orderBy(desc(schema.feedEntries.publishedAt))
    .limit(limit)
    .offset(offset);
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

export interface TopPost {
  botUsername: string;
  title: string;
  url: string;
  likeCount: number;
  boostCount: number;
  publishedAt: Date | null;
}

export async function getTopPosts(db: Db, limit: number): Promise<TopPost[]> {
  return db
    .select({
      botUsername: schema.feedEntries.botUsername,
      title: schema.feedEntries.title,
      url: schema.feedEntries.url,
      likeCount: schema.feedEntries.likeCount,
      boostCount: schema.feedEntries.boostCount,
      publishedAt: schema.feedEntries.publishedAt,
    })
    .from(schema.feedEntries)
    .where(isNull(schema.feedEntries.deletedAt))
    .orderBy(desc(sql`${schema.feedEntries.likeCount} + ${schema.feedEntries.boostCount}`))
    .limit(limit);
}

// --- Relay functions ---

export interface RelayRow {
  id: number;
  url: string;
  inboxUrl: string | null;
  actorId: string | null;
  status: "pending" | "accepted" | "rejected";
  followActivityId: string | null;
}

export async function getAcceptedRelays(db: Db): Promise<RelayRow[]> {
  return db
    .select({
      id: schema.relays.id,
      url: schema.relays.url,
      inboxUrl: schema.relays.inboxUrl,
      actorId: schema.relays.actorId,
      status: schema.relays.status,
      followActivityId: schema.relays.followActivityId,
    })
    .from(schema.relays)
    .where(and(eq(schema.relays.status, "accepted"), isNull(schema.relays.deletedAt)));
}

export async function getAllRelays(db: Db): Promise<RelayRow[]> {
  return db
    .select({
      id: schema.relays.id,
      url: schema.relays.url,
      inboxUrl: schema.relays.inboxUrl,
      actorId: schema.relays.actorId,
      status: schema.relays.status,
      followActivityId: schema.relays.followActivityId,
    })
    .from(schema.relays)
    .where(isNull(schema.relays.deletedAt));
}

export async function upsertRelay(
  db: Db,
  url: string,
  inboxUrl: string | null,
  actorId: string | null,
  followActivityId: string | null,
): Promise<void> {
  await db
    .insert(schema.relays)
    .values({ url, inboxUrl, actorId, followActivityId, status: "pending" })
    .onConflictDoUpdate({
      target: schema.relays.url,
      set: { inboxUrl, actorId, followActivityId, status: "pending" as const, deletedAt: null },
    });
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

export async function removeRelay(db: Db, url: string): Promise<void> {
  await db
    .update(schema.relays)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.relays.url, url), isNull(schema.relays.deletedAt)));
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
