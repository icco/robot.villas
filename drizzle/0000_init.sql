CREATE TABLE "actor_keypairs" (
	"bot_username" text PRIMARY KEY NOT NULL,
	"public_key" jsonb NOT NULL,
	"private_key" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "feed_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"bot_username" text NOT NULL,
	"guid" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_entries_bot_username_guid_unique" UNIQUE("bot_username","guid")
);
--> statement-breakpoint
CREATE TABLE "followers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "followers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"bot_username" text NOT NULL,
	"follower_id" text NOT NULL,
	"follow_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "followers_bot_username_follower_id_unique" UNIQUE("bot_username","follower_id")
);
