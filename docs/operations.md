# Operations

How robot.villas delivers posts, handles failures, and limits what remote servers can make it do.

## Publishing

- Each successful feed fetch refreshes valid publication dates on existing posts, including corrections and previously missing dates. Missing or invalid dates never erase a known date. This preserves post IDs and grabbed times and does not queue another Create; already-delivered copies on remote servers are not updated. HTTP 304 responses have no entries to refresh, so corrections are picked up when the feed next returns a changed body.
- A new feed entry and one delivery record per follower or relay inbox are saved in one transaction. A feed's cache headers are saved only after that, so a failure retries the same items on the next poll.
- Until a feed has a poll that committed every new entry (`last_success_at`), its entries are saved without delivery records, so adding a feed doesn't send its back catalog to followers, even if the first ingestion fails partway and is retried. Re-adding a removed bot starts over.
- Entries dated more than 7 days before they are fetched are saved without delivery records, so republished archives and backdated items don't reach followers' timelines. Undated entries are delivered.
- Future-dated entries are not saved. While a feed contains deferred entries, both HTTP validators are cleared so normal polls fetch the full body and reconsider them; caching resumes when none remain. Entries must remain in the source feed until eligible. Incorrect far-future dates increase download bandwidth. Migration 0023 clears existing validators once without changing polling or retry deadlines.
- A loop separate from feed polling hands pending records to Fedify's queue in batches of 100, back to back until none are due, then checks again every 5 seconds. A failing record backs off up to an hour. "Queued" means Fedify accepted it; Fedify then retries the remote server itself.
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

Before each feed request, including redirect destinations, the poller checks the origin's `/robots.txt` for `RobotVillas`, falling back to `User-agent: *`. Requests retain the User-Agent `robot.villas RSS poller/1.0 (+https://robot.villas/about)`. The parser's matching identity is separate from the HTTP header; groups named `robot.villas` or `RSS` do not match. Only a matching Disallow rule blocks the fetch; more-specific Allow rules and equal-length Allow rules take precedence. Blocked feeds report `Blocked by robots.txt` in their poll status without changing cached feed validators. Missing files, unsuccessful HTTP responses, network errors, timeouts, and oversized robots files do not block feeds. Robots checks have a separate 2-second timeout and 500 KiB body limit, reuse the public-address protections, and reuse rules only within one feed fetch. Federation requests are unaffected. See [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) for matching rules; fail-open error handling is intentional.

## Monitoring

- `/healthcheck`: 200 while the process serves HTTP
- `/readyz`: 503 if PostgreSQL doesn't answer within 3 seconds
- `/status`: publishing backlog, last successful poll and backoff per feed, and inbox signature results since the last restart

## Maintenance

Public keys cached before Fedify 2.4 never expire. To clear them, follow [Fedify's cleanup steps](https://fedify.dev/manual/kv#clearing-legacy-cache-entries) and delete only the key and signature-spec prefixes: the same table also holds queue state.
