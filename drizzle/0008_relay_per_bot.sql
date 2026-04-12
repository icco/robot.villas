-- Clear existing relay data so it can be re-established per-bot on next startup.
-- Required before adding the NOT NULL bot_username column.
TRUNCATE "relays" RESTART IDENTITY;--> statement-breakpoint
ALTER TABLE "relays" DROP CONSTRAINT "relays_url_unique";--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "bot_username" text NOT NULL;--> statement-breakpoint
ALTER TABLE "relays" ADD CONSTRAINT "relays_bot_username_url_unique" UNIQUE("bot_username","url");