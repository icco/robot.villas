ALTER TABLE followers ADD COLUMN shared_inbox_url TEXT;

-- Backfill shared inbox URL for existing merveilles.town followers.
-- Mastodon instances expose a shared inbox at /inbox.
UPDATE followers
SET shared_inbox_url = 'https://' || split_part(replace(follower_id, 'https://', ''), '/', 1) || '/inbox'
WHERE shared_inbox_url IS NULL;
