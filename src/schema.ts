import { integer, jsonb, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

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
  },
  (t) => [unique().on(t.botUsername, t.guid)],
);

export const actorKeypairs = pgTable("actor_keypairs", {
  botUsername: text("bot_username").primaryKey(),
  publicKey: jsonb("public_key").notNull(),
  privateKey: jsonb("private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
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
  },
  (t) => [unique().on(t.botUsername, t.handle)],
);

export const relayStatusEnum = pgEnum("relay_status", [
  "pending",
  "accepted",
  "rejected",
]);

export const relays = pgTable("relays", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  url: text().notNull().unique(),
  inboxUrl: text("inbox_url"),
  actorId: text("actor_id"),
  status: relayStatusEnum().notNull().default("pending"),
  followActivityId: text("follow_activity_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
