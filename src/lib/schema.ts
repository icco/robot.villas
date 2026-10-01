import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";

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

/** Activity IDs remain recorded after Undo so delayed/replayed deliveries cannot revive them. */
export const reactions = pgTable("reactions", {
  activityId: text("activity_id").primaryKey(),
  actorId: text("actor_id").notNull(),
  entryId: integer("entry_id").notNull().references(() => feedEntries.id),
  kind: text().$type<"like" | "boost" | "emoji">().notNull(),
  content: text().notNull().default(""),
  undoneAt: timestamp("undone_at", { withTimezone: true, mode: "date" }),
}, (t) => [
  uniqueIndex("reactions_active_unique").on(t.actorId, t.entryId, t.kind, t.content).where(sql`${t.undoneAt} IS NULL`),
]);

/** Transactional intent to submit one immutable post to one destination inbox. */
export const publications = pgTable("publications", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  entryId: integer("entry_id").notNull().references(() => feedEntries.id),
  actorId: text("actor_id").notNull(),
  inboxUrl: text("inbox_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  queuedAt: timestamp("queued_at", { withTimezone: true, mode: "date" }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
  attempts: integer().notNull().default(0),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [
  unique().on(t.entryId, t.inboxUrl),
  index("publications_pending_idx").on(t.nextAttemptAt).where(sql`${t.queuedAt} IS NULL AND ${t.cancelledAt} IS NULL`),
]);

/** Retained after removal to avoid repeat announcements. */
export const botRegistrations = pgTable("bot_registrations", {
  botUsername: text("bot_username").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  announcedAt: timestamp("announced_at", { withTimezone: true, mode: "date" }),
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
    /** When `status` last changed; null for pre-existing rows. */
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true, mode: "date" }),
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
    /** When `status` last changed; null for pre-existing rows. Drives the Reject cooldown. */
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true, mode: "date" }),
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
  /** `ETag` from the last 200/304, sent back as `If-None-Match` for conditional GET. */
  etag: text("etag"),
  /** `Last-Modified` from the last 200/304, sent back as `If-Modified-Since`. */
  lastModified: text("last_modified"),
  /** Set from a 429 `Retry-After`; the poller skips this feed until it passes. */
  nextPollAt: timestamp("next_poll_at", { withTimezone: true, mode: "date" }),
  /** Last fetch that parsed (or 304'd) and committed every new entry. */
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true, mode: "date" }),
  /** Lease so only one replica fetches a feed at a time. */
  claimedUntil: timestamp("claimed_until", { withTimezone: true, mode: "date" }),
});
