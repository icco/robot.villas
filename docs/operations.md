# Operations

How robot.villas delivers posts, handles failures, and limits what remote servers can make it do.

## Publishing

- A new feed entry and one delivery record per follower or relay inbox are saved in one transaction. A feed's cache headers are saved only after that, so a failure retries the same items on the next poll.
- The poller hands pending records to Fedify's queue, at most 100 per cycle, backing off up to an hour after errors. "Queued" means Fedify accepted it; Fedify then retries the remote server itself.
- A crash right after queueing can resend the same activity ID once (at-least-once).
- Blocking a host or removing a bot cancels its pending records. Finished records are deleted after 30 days.

## Replicas and background jobs

- Each feed is polled under a 10-minute lease that is renewed while work continues. A worker that loses its lease cannot overwrite the result.
- Startup jobs (follower inbox repair, relay and account follows, profile updates, removed-bot cleanup) are Fedify tasks on the `fedify_task_message_v2` queue table, retried up to five times. `maintenance_runs` makes each run once per build and config (`SOURCE_COMMIT` or `GIT_SHA`).
- A removed bot keeps its keys and followers until its `Delete` is queued. Afterwards its profile and posts return `410 Gone`.

## Inbox handling

- Accept and Reject change a subscription only when they come from the account or relay that was followed.
- Undo applies only to the sender's own Follow or reaction; Delete removes a follower only when the actor deletes itself.
- Each Like, Announce, and EmojiReact is counted once by activity ID, including duplicates, replays, and an Undo that arrives first. Reactions from before this ledger existed can't be undone individually.
- Fedify settings: at most 3 HTTP signatures checked per request, 10-second remote document timeout, public keys cached 30 days.

## Blocking

`blocked_instances` (plus `BLOCKED_INSTANCES`) applies to actor and inbox hosts, subdomains included. Blocked hosts get no posts, profile updates, deletions, follows, or relay subscriptions. Their Follows are Rejected without being stored. Their Accept, Reject, and reactions are ignored; Undo and Delete still apply because they only remove data.

## Remote fetches

Feeds are fetched only from public HTTP(S) addresses, checked when connecting and on each of at most 5 redirects. Responses are limited to 5 MiB. Feeds with a DTD, nesting deeper than 64, or more than 50,000 elements are rejected.

## Monitoring

- `/healthcheck`: 200 while the process serves HTTP
- `/readyz`: 503 if PostgreSQL doesn't answer within 3 seconds
- `/status`: publishing backlog, last successful poll and backoff per feed, and inbox signature results since the last restart

## Maintenance

Public keys cached before Fedify 2.4 never expire. To clear them, follow [Fedify's cleanup steps](https://fedify.dev/manual/kv#clearing-legacy-cache-entries) and delete only the key and signature-spec prefixes: the same table also holds queue state.
