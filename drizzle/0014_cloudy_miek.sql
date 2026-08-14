ALTER TABLE "feed_poll_status" ADD COLUMN "etag" text;--> statement-breakpoint
ALTER TABLE "feed_poll_status" ADD COLUMN "last_modified" text;--> statement-breakpoint
ALTER TABLE "feed_poll_status" ADD COLUMN "next_poll_at" timestamp with time zone;