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

## Remote fetch limits

RSS fetches accept only public HTTP(S) destinations without credentials. DNS is
checked at socket connection time, so a hostname cannot pass a preflight check
and then rebind to a private address. Each redirect hop is checked again, with a
limit of five. Conditional-request validators are dropped on cross-origin hops.
Bodies are streamed with a 5 MiB limit. Feeds with DTDs, nesting deeper than 64,
or more than 50,000 elements are rejected before the full parse.

`blocked_instances` applies to actor and inbox hosts for posts, profile updates,
deletion notices, follows, and relay subscriptions. Inbound Accept, Reject, Like,
Announce, and EmojiReact from blocked hosts are ignored. Undo and Delete are still
honored because they only remove state.

## Background jobs and replicas

Startup maintenance (inbox repair, relay and account follows, profile updates,
removed-bot deletion) runs as the `maintenance.v1` Fedify task on its own
PostgreSQL queue table, `fedify_task_message_v2`. Jobs retry with backoff, up to
five attempts. The `maintenance_runs` table records each job once per
deployment key, which hashes `SOURCE_COMMIT`/`GIT_SHA` with the parsed config.
Restarts and additional replicas of the same build therefore never repeat the
jobs. If enqueueing fails, the record is removed so the next start retries.

Each feed is polled under a 10-minute lease that is renewed while work
continues. A tokened claim fences status and validator writes, so a worker that
loses its lease cannot overwrite the new owner. Entry inserts are already
idempotent per GUID. A crashed replica's lease expires on its own.

Queued and cancelled publication rows are deleted after 30 days.

A removed bot keeps its keys and followers until its `Delete` is queued, so a
failed attempt can be retried and signed. After cleanup, its actor URL and
posts answer `410 Gone` with a `Tombstone`.

## Health and status

- `/healthcheck` is liveness. It returns 200 whenever the process can serve HTTP.
- `/readyz` is readiness. It returns 503 if PostgreSQL does not answer within three seconds; the query is cancelled at that point.
- `/status` shows publication backlog and failures, last successful poll and
  backoff per feed, and counts of inbox authentication results and outcomes
  since the last restart.
