import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

export const feedEntries = pgTable(
  "feed_entries",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    botUsername: text("bot_username").notNull(),
    guid: text().notNull(),
    url: text().notNull(),
    title: text().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    likeCount: integer("like_count").notNull().default(0),
    boostCount: integer("boost_count").notNull().default(0),
    /** Stored hashtag labels (no leading #), typically 0–3. Legacy rows may be []. */
    hashtags: jsonb("hashtags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    unique().on(t.botUsername, t.guid),
    // GIN index for fast JSONB array element lookups (tag filter + tag aggregation)
    index("feed_entries_hashtags_gin_idx").using("gin", t.hashtags).where(sql`${t.deletedAt} IS NULL`),
    // Partial index for chronological pagination across all non-deleted posts
    index("feed_entries_published_at_idx").on(t.publishedAt).where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const actorKeypairs = pgTable("actor_keypairs", {
  botUsername: text("bot_username").primaryKey(),
  publicKey: jsonb("public_key").notNull(),
  privateKey: jsonb("private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
});

export const followers = pgTable(
  "followers",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    botUsername: text("bot_username").notNull(),
    followerId: text("follower_id").notNull(),
    followId: text("follow_id").notNull(),
    sharedInboxUrl: text("shared_inbox_url"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [unique().on(t.botUsername, t.followerId)],
);

export const following = pgTable(
  "following",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    botUsername: text("bot_username").notNull(),
    handle: text().notNull(),
    targetActorId: text("target_actor_id"),
    followActivityId: text("follow_activity_id"),
    status: text().notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [unique().on(t.botUsername, t.handle)],
);

export const relayStatusEnum = pgEnum("relay_status", [
  "pending",
  "accepted",
  "rejected",
]);

export const relays = pgTable(
  "relays",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    botUsername: text("bot_username").notNull(),
    url: text().notNull(),
    inboxUrl: text("inbox_url"),
    actorId: text("actor_id"),
    status: relayStatusEnum().notNull().default("pending"),
    followActivityId: text("follow_activity_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [unique().on(t.botUsername, t.url)],
);

/** Last HTTP poll outcome per bot RSS feed (keyed by bot username). */
export const feedPollStatus = pgTable("feed_poll_status", {
  botUsername: text("bot_username").primaryKey(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true, mode: "date" }).notNull(),
  /** Response status when a response was received; null on network/timeout errors before headers. */
  lastHttpStatus: integer("last_http_status"),
  /** Null when the last poll completed successfully at HTTP + parse level. */
  lastError: text("last_error"),
});
