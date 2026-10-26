# Operations

How robot.villas delivers posts, handles failures, and limits what remote servers can make it do.

## Publishing

- Posts are unlisted, with the bot's followers collection in `to` and `as:Public` in `cc`. Mastodon hides unlisted posts from live feeds, explore, and search ([posting](https://docs.joinmastodon.org/user/posting/), [ActivityPub mapping](https://docs.joinmastodon.org/spec/activitypub/)).
- Each poll processes at most the first 100 items in a feed.
- A new entry and one delivery record per follower or relay inbox are saved in one transaction. A feed's cache headers are saved only after that, so a failure retries the same items on the next poll.
- Until a feed has a poll that committed every new entry (`last_success_at`), its entries are saved without delivery records, so adding a feed doesn't send its back catalog. Re-adding a removed bot starts over.
- Entries dated more than 7 days before they are fetched are saved without delivery records. Undated entries are delivered.
- Future-dated entries are not saved. While a feed has any, both HTTP validators are cleared so every poll fetches the full body; caching resumes when none remain. An entry must still be in the feed when its date arrives.
- A fetch updates an existing post's publication date when the feed gives a valid one; a missing or invalid date never erases one. No new Create is sent, so copies already delivered keep the old date. A 304 has no entries, so corrections wait for the next changed body.
- A loop separate from polling hands pending records to Fedify's queue in batches of 100, back to back until none are due, then checks every 5 seconds. A record that fails to queue backs off up to an hour. Once queued, Fedify retries the remote server itself, up to 10 times.
- A crash right after queueing can resend the same activity ID once (at-least-once).
- Removing a bot or blocking a host cancels its pending records as the hand-off loop reaches them. Finished records are deleted after 30 days.

## Queues

- Inbound activities, outbound deliveries, and fanout share Fedify's `fedify_message_v2` table, claimed oldest first, so a flood in either direction delays the other. Startup jobs use the separate `fedify_task_message_v2` table.
- `/status` counts pending delivery records only. Fedify's backlog is `select message->>'type', count(*) from fedify_message_v2 group by 1`. Never select `message` whole, because outbound messages contain the sending bot's private key.

## Relays

- One bot (`relay_subscription_bot`, default the first) follows each relay. Once the relay accepts, every bot's posts go to it, one delivery per post per relay.
- A relay sends us the posts it carries. Announces of other servers' posts are dropped before queueing (see Inbox handling).
- A Reject is honored for 30 days, then the Follow is sent again.
- Removing a relay from `feeds.yml` sends `Undo(Follow)`, soft-deletes its rows, and cancels its pending records at the next deploy, except a bot's records when one of its followers uses the same inbox. The cancellation runs before configured relays are re-subscribed, so re-adding a relay also drops its old pending records.
- `/status` shows each relay's stored subscription state, not delivery results. Before removing a relay as broken, compare `Successfully sent` with `Failed to send activity` for its inbox in the logs.

## Replicas and background jobs

- Each feed is polled under a 10-minute lease that is renewed while work continues. A worker that loses its lease cannot overwrite the result.
- Startup jobs (follower inbox repair, relay and account follows, profile updates, removed-bot cleanup) are Fedify tasks retried up to five times. `maintenance_runs` makes each run once per build and config (`SOURCE_COMMIT` or `GIT_SHA`).
- A removed bot keeps its keys and followers until its `Delete` is queued. Afterwards its profile and posts return `410 Gone`.

## Inbox handling

- Accept and Reject change a subscription only when they come from the account or relay that was followed.
- An Announce of a post on another server gets `202` and is dropped before Fedify queues it. Only boosts of our own posts are counted.
- Undo applies only to the sender's own Follow or reaction; Delete removes a follower only when the actor deletes itself.
- Each Like, Announce, and EmojiReact is counted once by activity ID, including duplicates, replays, and an Undo that arrives first.
- Fedify settings: at most 3 HTTP signatures checked per request, 10-second remote document timeout, public keys cached 30 days.

## Blocking

`blocked_instances` (plus `BLOCKED_INSTANCES`) applies to actor and inbox hosts, subdomains included. Blocked hosts get no posts, profile updates, deletions, follows, or relay subscriptions. Their Follows are Rejected without being stored. Their Accept, Reject, and reactions are ignored; Undo and Delete still apply because they only remove data.

## Remote fetches

Feeds are fetched only from public HTTP(S) addresses, checked when connecting and on each of at most 5 redirects. Responses are limited to 5 MiB. Feeds with a DTD, nesting deeper than 64, or more than 50,000 elements are rejected.

Before each feed request, including redirects, the poller checks the origin's `/robots.txt` for `RobotVillas`, falling back to `User-agent: *`, with [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) matching. Only a matching Disallow blocks a fetch, and the feed's status then reads `Blocked by robots.txt`. Missing or oversized (over 500 KiB) files, error responses, and timeouts (2 seconds) never block, because the check fails open on purpose. Rules are reused only within one feed fetch, and federation requests are not checked.

## Monitoring

- `/healthcheck`: 200 while the process serves HTTP
- `/readyz`: 503 if PostgreSQL doesn't answer within 3 seconds
- `/status`: publishing backlog, relay subscriptions, account follows, last successful poll and backoff per feed, and inbox results since the last restart

## Maintenance

Public keys cached before Fedify 2.4 never expire. To clear them, follow [Fedify's cleanup steps](https://fedify.dev/manual/kv#clearing-legacy-cache-entries) and delete only the key and signature-spec prefixes: the same table also holds queue state.
