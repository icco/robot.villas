CREATE TABLE IF NOT EXISTS "actor_keypairs" (
	"bot_username" text PRIMARY KEY NOT NULL,
	"public_key" jsonb NOT NULL,
	"private_key" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feed_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"bot_username" text NOT NULL,
	"guid" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_entries_bot_username_guid_unique" UNIQUE("bot_username","guid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "followers" (
	"id" serial PRIMARY KEY NOT NULL,
	"bot_username" text NOT NULL,
	"follower_id" text NOT NULL,
	"follow_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "followers_bot_username_follower_id_unique" UNIQUE("bot_username","follower_id")
);
