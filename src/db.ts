import { and, count, desc, eq } from "drizzle-orm";
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
    .where(and(eq(schema.feedEntries.botUsername, botUsername), eq(schema.feedEntries.guid, guid)))
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
    .onConflictDoNothing({ target: [schema.feedEntries.botUsername, schema.feedEntries.guid] })
    .returning({ id: schema.feedEntries.id });
  return rows[0]?.id ?? null;
}

export async function countFollowers(db: Db, botUsername: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(schema.followers)
    .where(eq(schema.followers.botUsername, botUsername));
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
    .where(eq(schema.followers.botUsername, botUsername));
  return rows.map((r) => r.followerId);
}

export async function getFollowerRecipients(db: Db, botUsername: string): Promise<FollowerRow[]> {
  return db
    .select({
      followerId: schema.followers.followerId,
      sharedInboxUrl: schema.followers.sharedInboxUrl,
    })
    .from(schema.followers)
    .where(eq(schema.followers.botUsername, botUsername));
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
    .onConflictDoNothing({ target: [schema.followers.botUsername, schema.followers.followerId] });
}

export async function removeFollower(db: Db, botUsername: string, followerId: string): Promise<void> {
  await db
    .delete(schema.followers)
    .where(and(eq(schema.followers.botUsername, botUsername), eq(schema.followers.followerId, followerId)));
}

export async function countEntries(db: Db, botUsername: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(schema.feedEntries)
    .where(eq(schema.feedEntries.botUsername, botUsername));
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
    .where(and(eq(schema.feedEntries.botUsername, botUsername), eq(schema.feedEntries.id, entryId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getEntriesPage(
  db: Db,
  botUsername: string,
  limit: number,
  offset: number,
): Promise<
  Array<{ id: number; url: string; title: string; publishedAt: Date | null }>
> {
  return db
    .select({
      id: schema.feedEntries.id,
      url: schema.feedEntries.url,
      title: schema.feedEntries.title,
      publishedAt: schema.feedEntries.publishedAt,
    })
    .from(schema.feedEntries)
    .where(eq(schema.feedEntries.botUsername, botUsername))
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
    .where(eq(schema.actorKeypairs.botUsername, botUsername));
  if (rows.length === 0) return null;
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
      set: { publicKey, privateKey },
    });
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
    .where(eq(schema.relays.status, "accepted"));
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
    .from(schema.relays);
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
      set: { inboxUrl, actorId, followActivityId, status: "pending" as const },
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
  await db.delete(schema.relays).where(eq(schema.relays.url, url));
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
    .from(schema.following);
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
    .onConflictDoNothing({ target: [schema.following.botUsername, schema.following.handle] });
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
    .where(eq(schema.following.followActivityId, followActivityId))
    .limit(1);
  return rows[0] ?? null;
}
