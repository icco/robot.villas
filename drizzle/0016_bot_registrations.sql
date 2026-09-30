CREATE TABLE "bot_registrations" (
	"bot_username" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"announced_at" timestamp with time zone
);
--> statement-breakpoint
-- Skip existing accounts, including removed ones.
INSERT INTO "bot_registrations" ("bot_username", "created_at", "announced_at")
SELECT "bot_username", "created_at", now() FROM "actor_keypairs";
