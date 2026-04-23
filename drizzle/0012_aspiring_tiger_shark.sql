-- Custom SQL migration file, put your code below! --

-- Drop rejected relay subscriptions so they are retried on next startup.
-- Previously, Follow activities used object=<relay-actor-url> which ActivityRelay
-- interprets as a LitePub peer-relay request (rejected unless sender URL ends in /relay).
-- The correct format is object=PUBLIC_COLLECTION (as:Public). Deleting the rejected rows
-- means subscribeToRelays will see no existing entry and call upsertRelay, which inserts
-- a fresh row (status=pending) with the new correctly-formatted Follow activity ID.
DELETE FROM relays WHERE status = 'rejected' AND deleted_at IS NULL;