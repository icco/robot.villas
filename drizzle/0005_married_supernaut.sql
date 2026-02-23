ALTER TABLE "feed_entries" ADD COLUMN "like_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feed_entries" ADD COLUMN "boost_count" integer DEFAULT 0 NOT NULL;