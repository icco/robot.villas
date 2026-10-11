DELETE FROM reactions
WHERE entry_id IN (
  SELECT id FROM feed_entries WHERE published_at > CURRENT_TIMESTAMP
);
--> statement-breakpoint
DELETE FROM publications
WHERE entry_id IN (
  SELECT id FROM feed_entries WHERE published_at > CURRENT_TIMESTAMP
);
--> statement-breakpoint
DELETE FROM feed_entries WHERE published_at > CURRENT_TIMESTAMP;
