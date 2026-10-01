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
