import { jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

export const feedEntries = pgTable(
  "feed_entries",
  {
    id: serial("id").primaryKey(),
    botUsername: text("bot_username").notNull(),
    guid: text("guid").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.botUsername, t.guid)],
);

export const actorKeypairs = pgTable("actor_keypairs", {
  botUsername: text("bot_username").primaryKey(),
  publicKey: jsonb("public_key").notNull(),
  privateKey: jsonb("private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const followers = pgTable(
  "followers",
  {
    id: serial("id").primaryKey(),
    botUsername: text("bot_username").notNull(),
    followerId: text("follower_id").notNull(),
    followId: text("follow_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.botUsername, t.followerId)],
);
