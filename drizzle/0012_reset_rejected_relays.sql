-- Reset rejected relay subscriptions to pending so they are retried on next startup.
-- Previously, Follow activities used object=<relay-actor-url> which ActivityRelay
-- interprets as a LitePub peer-relay request (rejected unless sender URL ends in /relay).
-- The correct format is object=PUBLIC_COLLECTION (as:Public). After resetting to pending,
-- the fixed code will re-send the Follow with the correct object on next deploy.
UPDATE relays SET status = 'pending' WHERE status = 'rejected' AND deleted_at IS NULL;
