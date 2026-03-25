ALTER TABLE "feed_entries" ADD COLUMN "hashtags" jsonb NOT NULL DEFAULT '["RSS","Feed","Bot"]'::jsonb;--> statement-breakpoint
ALTER TABLE "feed_entries" ALTER COLUMN "hashtags" DROP DEFAULT;