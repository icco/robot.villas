# Federation operations

## Fedify 2.4 rollout

Upgrade all Fedify packages together. Deploy workers before producers when they
run separately. The application keeps the 2.4 security defaults: three HTTP
signatures, ten-second document loads, 30-day key caches, and 90-day signature
spec caches. Portable actor hosting and portable-recipient persistence are not
part of this rollout.

`PostgresKvStore` converts existing unlogged KV tables to logged tables during
initialization. Inspect their sizes and schedule the first startup during a quiet
period: PostgreSQL rewrites and exclusively locks these tables. Keep a database
backup and allow the rewrite to finish before rolling additional instances.
Do not opt back into unlogged storage for durable queue state.

Legacy cached keys/specs written before 2.4 have no expiry. Follow the upstream
[cache cleanup procedure](https://fedify.dev/manual/kv#clearing-legacy-cache-entries)
for the configured PostgreSQL table and prefixes. Delete only key/spec cache
entries, never the entire KV table (which also stores queue/circuit-breaker state).

The reaction ledger tracks new activity identities and their retractions. Existing
aggregate counts are retained as a historical baseline; old reactions without a
ledger record cannot be individually retracted safely. Duplicate and out-of-order
activities received after the upgrade are idempotent.

## Publication recovery

New RSS entries and one submission intent per destination inbox commit in the
same transaction. HTTP validators advance only after all entries have committed.
The publication worker retries failed queue submissions independently of RSS
responses, including 304 responses, with exponential backoff capped at one hour.
Each batch processes at most 100 destinations. Concurrent workers use row locks
and skip claimed rows. Added blocks and removed bots cancel pending submissions.

`queued_at` means Fedify accepted the activity, not that a remote server received
it. Fedify owns subsequent network retries. A connection loss after enqueue can
resubmit the same stable ActivityPub ID: this is at-least-once submission, not
exactly-once delivery. Existing posts are not backfilled into the publication
outbox, avoiding an unsolicited replay of the entire archive.
