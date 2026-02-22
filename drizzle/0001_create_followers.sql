CREATE TABLE IF NOT EXISTS "followers" (
	"id" serial PRIMARY KEY NOT NULL,
	"bot_username" text NOT NULL,
	"follower_id" text NOT NULL,
	"follow_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "followers_bot_username_follower_id_unique" UNIQUE("bot_username","follower_id")
);
