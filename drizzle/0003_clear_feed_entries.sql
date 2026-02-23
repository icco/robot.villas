-- Clear all feed entries so they are re-fetched and delivered correctly.
-- This is needed because entries inserted before any followers existed
-- were permanently skipped for ActivityPub delivery and can never be retried.
TRUNCATE feed_entries RESTART IDENTITY;
