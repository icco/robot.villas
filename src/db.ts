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

export async function insertEntry(
  db: Db,
  botUsername: string,
  guid: string,
  url: string,
  title: string,
  publishedAt: Date | null,
): Promise<void> {
  await db
    .insert(schema.feedEntries)
    .values({ botUsername, guid, url, title, publishedAt })
    .onConflictDoNothing({ target: [schema.feedEntries.botUsername, schema.feedEntries.guid] });
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

export async function getEntriesPage(
  db: Db,
  botUsername: string,
  limit: number,
  offset: number,
): Promise<
  Array<{ guid: string; url: string; title: string; publishedAt: Date | null }>
> {
  return db
    .select({
      guid: schema.feedEntries.guid,
      url: schema.feedEntries.url,
      title: schema.feedEntries.title,
      publishedAt: schema.feedEntries.publishedAt,
    })
    .from(schema.feedEntries)
    .where(eq(schema.feedEntries.botUsername, botUsername))
    .orderBy(desc(schema.feedEntries.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getKeypair(
  db: Db,
  botUsername: string,
): Promise<{ publicKey: JsonWebKey; privateKey: JsonWebKey } | null> {
  const rows = await db
    .select({
      publicKey: schema.actorKeypairs.publicKey,
      privateKey: schema.actorKeypairs.privateKey,
    })
    .from(schema.actorKeypairs)
    .where(eq(schema.actorKeypairs.botUsername, botUsername));
  if (rows.length === 0) return null;
  return {
    publicKey: rows[0].publicKey as JsonWebKey,
    privateKey: rows[0].privateKey as JsonWebKey,
  };
}

export async function saveKeypair(
  db: Db,
  botUsername: string,
  publicKey: JsonWebKey,
  privateKey: JsonWebKey,
): Promise<void> {
  await db
    .insert(schema.actorKeypairs)
    .values({ botUsername, publicKey, privateKey })
    .onConflictDoNothing({ target: schema.actorKeypairs.botUsername });
}
