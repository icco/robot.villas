import { and, count, desc, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate as runMigrations } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";
import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema>;

export function createDb(client: postgres.Sql): Db {
  return drizzle(client, { schema });
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

export async function getFollowers(db: Db, botUsername: string): Promise<string[]> {
  const rows = await db
    .select({ followerId: schema.followers.followerId })
    .from(schema.followers)
    .where(eq(schema.followers.botUsername, botUsername));
  return rows.map((r) => r.followerId);
}

export async function addFollower(
  db: Db,
  botUsername: string,
  followerId: string,
  followId: string,
): Promise<void> {
  await db
    .insert(schema.followers)
    .values({ botUsername, followerId, followId })
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
