-- Custom SQL migration file, put your code below! --

-- Drop stored hashtags longer than MAX_TAG_LEN (32). These predate the length
-- rule and render as unreadable one-word walls on /tags.
UPDATE feed_entries
SET hashtags = COALESCE(
  (
    SELECT jsonb_agg(t.v)
    FROM jsonb_array_elements_text(hashtags) AS t(v)
    WHERE length(t.v) <= 32
  ),
  '[]'::jsonb
)
WHERE jsonb_typeof(hashtags) = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(hashtags) AS t(v)
    WHERE length(t.v) > 32
  );
