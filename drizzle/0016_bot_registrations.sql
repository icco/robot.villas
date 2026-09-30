CREATE TABLE "bot_registrations" (
	"bot_username" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"announced_at" timestamp with time zone
);
--> statement-breakpoint
-- Existing accounts form the baseline; do not flood followers with historical signups.
-- Include removed accounts so re-adding a username does not announce it a second time.
INSERT INTO "bot_registrations" ("bot_username", "created_at", "announced_at")
SELECT "bot_username", "created_at", now() FROM "actor_keypairs";
