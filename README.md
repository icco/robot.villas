# robot.villas

An RSS-to-fediverse bridge. Each feed in `feeds.yml` becomes a bot account (for example `@hackernews@robot.villas`) that anyone on Mastodon or another ActivityPub server can follow.

## Configuration

`feeds.yml` defines the bots. Editors can validate it with `feeds.schema.json`.

```yaml
# yaml-language-server: $schema=./feeds.schema.json
bots:
  hackernews:                 # username: lowercase letters, digits, underscores
    feed_url: https://news.ycombinator.com/rss
    display_name: Hacker News # max 100 chars
    summary: Top stories from Hacker News # max 500 chars
    profile_photo: https://news.ycombinator.com/y18.svg # optional
    homepage_url: https://news.ycombinator.com          # optional
    default_hashtags: [Tech, News]                      # optional, up to 3
follows: ["@someone@mastodon.social"] # every bot follows these
relays: [https://relay.toot.io/actor] # instance relays to subscribe to
relay_subscription_bot: hackernews    # bot that subscribes to relays (default: first bot)
blocked_instances: [spam.example]     # blocked both ways, subdomains included
meta: true                            # adds @meta, which announces new bots
```

URLs must be HTTP(S). Feeds are polled every 15 minutes with conditional requests, and a `429` pauses a feed until its `Retry-After`.

## Environment

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | required |
| `DOMAIN` | Public domain for ActivityPub IDs and handles | required |
| `PORT` | HTTP port | `3000` (`8080` in Docker) |
| `BLOCKED_INSTANCES` | Comma-separated hosts added to `blocked_instances` | |
| `POLL_CONCURRENCY` | Feeds fetched at once | `10` |
| `DISABLE_BACKGROUND` | `true` serves HTTP only (no queue, jobs, or poller) | |
| `SOURCE_COMMIT` or `GIT_SHA` | Build ID; startup jobs run once per build and config | |
| `GEMINI_API_KEY` or `GEMINI_PROJECT` | Enables AI hashtag suggestions (API key or Vertex AI) | |
| `GEMINI_LOCATION` | Vertex AI region | `us-central1` |
| `GEMINI_MODEL` | Gemini model | `gemini-2.5-flash-lite` |

## Development

Requires Node 26, pnpm, and PostgreSQL. Migrations run on startup.

```bash
pnpm install
DATABASE_URL=postgres://localhost/robot_villas DOMAIN=localhost pnpm dev
```

| Command | Does |
| --- | --- |
| `pnpm test` | Vitest; database tests run only when `DATABASE_URL` is set |
| `pnpm lint:check` | What CI runs: ESLint (including `@fedify/lint`), YAML format, typecheck |
| `pnpm lint` | Same, but fixes what it can |
| `pnpm validate-feeds` | Checks `feeds.yml`; add `--skip-network` to skip avatar probes |
| `pnpm db:generate` | Creates a migration in `drizzle/` after editing `src/lib/schema.ts` |

## Endpoints

- `/@name`: bot profile with its posts
- `/status`: feed health, publishing backlog, relays, follows, and inbox results
- `/healthcheck` (liveness) and `/readyz` (database reachable)
- ActivityPub, WebFinger, and NodeInfo are served by [Fedify](https://fedify.dev/) through `src/proxy.ts`

## Layout

```
src/app/         Next.js pages and routes
src/proxy.ts     Sends federation requests to Fedify
src/instrumentation.ts  Startup: migrations, queue workers, jobs, poller
src/lib/
  federation.ts  Actors, objects, collections, inbox listeners
  inbox-state.ts Follow responses and reactions (authorized, idempotent)
  poller.ts      Feed polling with per-feed leases
  rss.ts         Feed fetching and parsing
  publisher.ts   Stores new entries with their delivery records
  publications.ts Retries queue submission for each inbox
  maintenance.ts Startup jobs as Fedify background tasks
  remote-fetch.ts Public-address-only, size-limited fetching
  schema.ts, db.ts  Drizzle schema and queries
drizzle/         SQL migrations
docs/operations.md  How delivery, retries, and limits behave
```

## Deployment

`main` publishes `ghcr.io/icco/robot.villas:main` after CI passes and the built image passes a smoke test. `feeds.yml` is baked into the image; mount a file over `/app/feeds.yml` to override it.

## License

MIT
