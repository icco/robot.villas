import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as runMigrations } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";
import type { FeedEntry } from "./feed-entry";
import { MAX_TAGS } from "./hashtags";
import * as schema from "./schema";
import { summarizeRelaySubscription, type RelaySubscriptionState } from "./subscriptions";

export type Db = ReturnType<typeof createDb>;

export function createDb(client: postgres.Sql) {
  return drizzle({ client, schema });
}

export async function migrate(db: Db): Promise<void> {
  await runMigrations(db, { migrationsFolder: "./drizzle" });
}

/** Attempts, and the backoff before each retry. Spans ~30s, enough for a Postgres restart. */
const MIGRATE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

/**
 * Runs {@link migrate}, retrying on any failure -- the expected one being a database that is
 * still coming up. Rethrows the last error once attempts are exhausted, so a genuinely broken
 * migration surfaces after ~30s instead of retrying forever.
 */
export async function migrateWithRetry(
  db: Db,
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void,
  /** Tests only. */
  deps: {
    run?: (db: Db) => Promise<void>;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<void> {
  const run = deps.run ?? migrate;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      await run(db);
      return;
    } catch (err) {
      const delayMs = MIGRATE_RETRY_DELAYS_MS[attempt];
      if (delayMs == null) {
        throw err;
      }
      onRetry?.(attempt + 1, delayMs, err);
      await sleep(delayMs);
    }
  }
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
 * Batched version of hasEntry: looks up which of the given guids already
 * exist (and are not soft-deleted) for a bot in a single round trip, instead
 * of one query per guid. Used to dedup a whole feed poll's items at once.
 */
export async function getExistingGuids(
  db: Db,
  botUsername: string,
  guids: string[],
): Promise<Set<string>> {
  if (guids.length === 0) {
    return new Set();
  }
  const rows = await db
    .select({ guid: schema.feedEntries.guid })
    .from(schema.feedEntries)
    .where(
      and(
        eq(schema.feedEntries.botUsername, botUsername),
        inArray(schema.feedEntries.guid, guids),
        isNull(schema.feedEntries.deletedAt),
      ),
    );
  return new Set(rows.map((r) => r.guid));
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

/**
 * Total non-deleted entry count across all given bots, in one query.
 * Use instead of summing countEntries() per bot in a loop.
 */
export async function countEntriesForBots(db: Db, botUsernames: string[]): Promise<number> {
  if (botUsernames.length === 0) {
    return 0;
  }
  const rows = await db
    .select({ value: count() })
    .from(schema.feedEntries)
    .where(
      and(
        inArray(schema.feedEntries.botUsername, botUsernames),
        isNull(schema.feedEntries.deletedAt),
      ),
    );
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

export interface TagsPage {
  tags: Array<{ tag: string; postCount: number }>;
  /** Total number of distinct tags, i.e. across every page. */
  total: number;
}

/**
 * One page of hashtags, most-used first. `tag ASC` is a required tie-break:
 * most tags share the same post count, so without it LIMIT/OFFSET repeats
 * tags across pages and drops others. `count(*) OVER ()` gets the total in
 * the same pass instead of a second unnest + GROUP BY over every entry.
 */
export async function getTagsPage(db: Db, limit: number, offset: number): Promise<TagsPage> {
  const result = await db.execute<{ tag: string; post_count: number; total: number }>(sql`
    SELECT tag, post_count, (count(*) OVER ())::int AS total
    FROM (
      SELECT lower(t.v) AS tag, count(*)::int AS post_count
      FROM ${schema.feedEntries},
           jsonb_array_elements_text(${schema.feedEntries.hashtags}) AS t(v)
      WHERE ${schema.feedEntries.deletedAt} IS NULL
      GROUP BY lower(t.v)
    ) AS grouped
    ORDER BY post_count DESC, tag ASC
    LIMIT ${limit} OFFSET ${offset}
  `);
  return {
    tags: result.map((r) => ({ tag: r.tag, postCount: r.post_count })),
    total: result[0]?.total ?? 0,
  };
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

/** Hard delete: feed_poll_status has no deleted_at, one row per bot. */
export async function removeFeedPollStatus(db: Db, botUsername: string): Promise<void> {
  await db.delete(schema.feedPollStatus).where(eq(schema.feedPollStatus.botUsername, botUsername));
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

export async function getPerBotStats(
  db: Db,
  /** Every configured bot; those with no feed rows get zeros and still appear. */
  botUsernames: string[],
): Promise<BotStats[]> {
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

  const postMap = new Map(postStats.map((r) => [r.botUsername, r]));

  const followerCounts = await db
    .select({
      botUsername: schema.followers.botUsername,
      followerCount: count(),
    })
    .from(schema.followers)
    .where(isNull(schema.followers.deletedAt))
    .groupBy(schema.followers.botUsername);

  const followerMap = new Map(followerCounts.map((r) => [r.botUsername, r.followerCount]));

  return botUsernames.map((botUsername) => {
    const r = postMap.get(botUsername);
    return {
      botUsername,
      postCount: r?.postCount ?? 0,
      followerCount: followerMap.get(botUsername) ?? 0,
      totalLikes: r ? Number(r.totalLikes) : 0,
      totalBoosts: r ? Number(r.totalBoosts) : 0,
      latestPostAt: r?.latestPostAt ?? null,
    };
  });
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

/**
 * Soft-deletes non-designated relay rows (pending or rejected only) for the given URLs.
 * Keeps "accepted" on any bot so `getAcceptedRelays` and delivery still work. Run before
 * subscribing with a single designated bot to clear old per-bot rejections.
 */
export async function pruneRedundantRelaySubscriptions(
  db: Db,
  designatedBot: string,
  relayUrls: string[],
): Promise<void> {
  if (relayUrls.length === 0) {
    return;
  }
  await db
    .update(schema.relays)
    .set({ deletedAt: new Date() })
    .where(
      and(
        isNull(schema.relays.deletedAt),
        inArray(schema.relays.url, relayUrls),
        ne(schema.relays.botUsername, designatedBot),
        or(
          eq(schema.relays.status, "pending"),
          eq(schema.relays.status, "rejected"),
        )!,
      )!,
    );
}

export interface RelayRow {
  id: number;
  botUsername: string;
  url: string;
  inboxUrl: string | null;
  actorId: string | null;
  status: "pending" | "accepted" | "rejected";
  statusChangedAt: Date | null;
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
      statusChangedAt: schema.relays.statusChangedAt,
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
      statusChangedAt: schema.relays.statusChangedAt,
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
    .values({
      botUsername,
      url,
      inboxUrl,
      actorId,
      followActivityId,
      status: "pending",
      statusChangedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.relays.botUsername, schema.relays.url],
      set: {
        inboxUrl,
        actorId,
        followActivityId,
        status: "pending" as const,
        // Only a real transition restamps, so a permanently-pending relay
        // doesn't look freshly changed on every boot.
        statusChangedAt: sql`CASE WHEN ${schema.relays.status} = 'pending'
          AND ${schema.relays.statusChangedAt} IS NOT NULL
          THEN ${schema.relays.statusChangedAt} ELSE now() END`,
        deletedAt: null,
      },
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
      statusChangedAt: schema.relays.statusChangedAt,
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
    .set({ status, statusChangedAt: new Date() })
    .where(eq(schema.relays.followActivityId, followActivityId));
}

export async function removeRelay(db: Db, botUsername: string, url: string): Promise<void> {
  await db
    .update(schema.relays)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.relays.botUsername, botUsername), eq(schema.relays.url, url), isNull(schema.relays.deletedAt)));
}

// --- Status summary functions ---

export type RelayStatusSummary = RelaySubscriptionState & { url: string };

/**
 * Returns one instance-level subscription state per relay URL. A relay keys
 * subscriptions by domain, so this is a single state, not a per-bot tally.
 */
export async function getRelayStatusSummary(db: Db): Promise<RelayStatusSummary[]> {
  const byUrl = new Map<string, RelayRow[]>();
  for (const row of await getAllRelays(db)) {
    const rows = byUrl.get(row.url);
    if (rows === undefined) {
      byUrl.set(row.url, [row]);
    } else {
      rows.push(row);
    }
  }
  return [...byUrl].map(([url, rows]) => ({ url, ...summarizeRelaySubscription(rows) }));
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
    .values({
      botUsername,
      handle,
      targetActorId,
      followActivityId,
      status: "pending",
      statusChangedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.following.botUsername, schema.following.handle],
      set: {
        targetActorId,
        followActivityId,
        status: "pending",
        // See upsertRelay: retries must not restamp an unchanged status.
        statusChangedAt: sql`CASE WHEN ${schema.following.status} = 'pending'
          AND ${schema.following.statusChangedAt} IS NOT NULL
          THEN ${schema.following.statusChangedAt} ELSE now() END`,
        deletedAt: null,
      },
    });
}

export async function updateFollowingStatus(
  db: Db,
  followActivityId: string,
  status: "accepted" | "rejected",
): Promise<void> {
  await db
    .update(schema.following)
    .set({ status, statusChangedAt: new Date() })
    .where(eq(schema.following.followActivityId, followActivityId));
}

/** Records follows the target already lists as followers. See `findLostAccepts`. */
export async function markFollowingAccepted(
  db: Db,
  handle: string,
  botUsernames: string[],
): Promise<void> {
  if (botUsernames.length === 0) {
    return;
  }
  await db
    .update(schema.following)
    .set({ status: "accepted", statusChangedAt: new Date() })
    .where(
      and(
        eq(schema.following.handle, handle),
        inArray(schema.following.botUsername, botUsernames),
        // The caller's pending set is a snapshot; don't clobber a Reject that
        // landed since.
        eq(schema.following.status, "pending"),
        isNull(schema.following.deletedAt),
      )!,
    );
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
  etag: string | null;
  lastModified: string | null;
  nextPollAt: Date | null;
}

export async function upsertFeedPollStatus(
  db: Db,
  status: FeedPollStatusRow,
): Promise<void> {
  const { lastCheckedAt, lastHttpStatus, lastError, etag, lastModified, nextPollAt } = status;
  await db
    .insert(schema.feedPollStatus)
    .values(status)
    .onConflictDoUpdate({
      target: schema.feedPollStatus.botUsername,
      set: { lastCheckedAt, lastHttpStatus, lastError, etag, lastModified, nextPollAt },
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
      etag: schema.feedPollStatus.etag,
      lastModified: schema.feedPollStatus.lastModified,
      nextPollAt: schema.feedPollStatus.nextPollAt,
    })
    .from(schema.feedPollStatus)
    .where(inArray(schema.feedPollStatus.botUsername, botUsernames));
  return new Map(rows.map((r) => [r.botUsername, r]));
}
