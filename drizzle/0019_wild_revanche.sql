ALTER TABLE "feed_poll_status" ADD COLUMN "last_success_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feed_poll_status" ADD COLUMN "claimed_until" timestamp with time zone;