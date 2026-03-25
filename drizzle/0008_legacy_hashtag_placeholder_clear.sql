-- Rows that only had the initial migration placeholder should stay empty until
-- backfilled; real posts store three distinct tags (coinciding with this exact
-- triple is extremely unlikely).
UPDATE "feed_entries" SET "hashtags" = '[]'::jsonb WHERE "hashtags" = '["RSS","Feed","Bot"]'::jsonb;
