ALTER TABLE "followers" ADD COLUMN IF NOT EXISTS "shared_inbox_url" text;

--> statement-breakpoint
UPDATE followers
SET shared_inbox_url = 'https://' || split_part(replace(follower_id, 'https://', ''), '/', 1) || '/inbox'
WHERE shared_inbox_url IS NULL;