-- Clear existing relay subscriptions; they will be re-established on next startup
-- with per-bot tracking.
DELETE FROM "relays";
--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "bot_username" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "relays" ALTER COLUMN "bot_username" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "relays" DROP CONSTRAINT "relays_url_unique";
--> statement-breakpoint
ALTER TABLE "relays" ADD CONSTRAINT "relays_bot_username_url_unique" UNIQUE("bot_username","url");
