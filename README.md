# robot.villas

An RSS-to-Mastodon bridge. Each RSS feed gets its own bot account on the fediverse, discoverable via WebFinger (e.g. `@hackernews@robot.villas`). Fediverse users can follow any bot from Mastodon or other ActivityPub-compatible platforms and receive new posts in their timeline.

## Configuration

Bots, follows, and relays are configured in `feeds.yml`:

```yaml
# yaml-language-server: $schema=./feeds.schema.json
bots:
  hackernews:
    feed_url: "https://news.ycombinator.com/rss"
    display_name: "Hacker News"
    summary: "Top stories from Hacker News"
    profile_photo: "https://news.ycombinator.com/y18.svg"
    default_hashtags:
      - Tech
      - News
follows:
  - "@someone@mastodon.social"
relays:
  - https://relay.toot.io/actor
```

`feeds.schema.json` contains a JSON Schema spec for `feeds.yml` that can be used by editors and external validators.

Each key under `bots` becomes the bot's fediverse username. Usernames must be lowercase alphanumeric or underscores (validated at startup via Zod).

| Field              | Required | Description                                          |
| ------------------ | -------- | ---------------------------------------------------- |
| `feed_url`         | Yes      | URL of the RSS/Atom feed                             |
| `display_name`     | Yes      | Display name shown on the profile (max 100 chars)    |
| `summary`          | Yes      | Short bio/description (max 500 chars)                |
| `profile_photo`    | No       | URL to an avatar image                               |
| `homepage_url`     | No       | Site linked from the profile                         |
| `default_hashtags` | No       | Up to 3 default hashtags (no leading `#`)            |

The `follows` list contains fediverse handles (`@user@instance`) that every bot will send a Follow to on startup.

The `relays` list contains ActivityPub relay actor URLs. The server subscribes to these on startup so posts reach a wider audience.

`blocked_instances` lists hostnames to refuse in both directions (subdomains included); `BLOCKED_INSTANCES` adds to it without a deploy.

### New account announcements

Enable the built-in `@meta@robot.villas` bot with a top-level flag in `feeds.yml`:

```yaml
meta: true
```

Defaults to `false`. Its username and profile are fixed; do not add it under `bots`.
After deployment, it posts each new account's name, handle, summary, and profile link.
Restarts do not repeat posts. The migration skips accounts with existing actor keys;
a fresh database announces all RSS bots.
Failed queue submissions retry the stored activity on the next poll.

## Environment Variables

| Variable            | Description                                      | Default            |
| ------------------- | ------------------------------------------------ | ------------------ |
| `DATABASE_URL`      | PostgreSQL connection string                     | (required)         |
| `DOMAIN`            | Public domain for ActivityPub IDs and WebFinger  | (required)         |
| `PORT`              | HTTP server port                                 | `3000`             |
| `BLOCKED_INSTANCES` | Extra comma-separated hostnames to block         | (none)             |
| `POLL_CONCURRENCY`  | Feeds fetched at once                            | `10`               |
| `DISABLE_BACKGROUND`| `true` serves HTTP only: no queue or poller      | (unset)            |
| `SOURCE_COMMIT`     | Build identifier; keys once-per-deploy jobs      | (none)             |
| `GEMINI_API_KEY`    | Google Gemini API key for AI hashtag suggestions | (none)             |
| `GEMINI_PROJECT`    | GCP project for Vertex AI (alternative to key)   | (none)             |
| `GEMINI_LOCATION`   | GCP region for Vertex AI                         | `us-central1`     |
| `GEMINI_MODEL`      | Gemini model name                                | `gemini-2.5-flash` |

The poller identifies itself with a `robot.villas` User-Agent, sends conditional GETs (`If-None-Match` / `If-Modified-Since`) so unchanged feeds cost a 304, and stops polling a feed until the `Retry-After` of a 429 has elapsed. Feeds are fetched at most once every 15 minutes — a constant (`DEFAULT_INTERVAL_MS` in `src/lib/poller.ts`), not a config knob.

## Development

```bash
nvm use
pnpm install
export DATABASE_URL="postgres://user:password@localhost:5432/robot_villas"
export DOMAIN="robot.villas"
pnpm dev
```

A running PostgreSQL instance is required. Migrations are applied automatically on startup.

`pnpm test` runs the suite; database-backed tests are skipped unless `DATABASE_URL` is set. `pnpm lint:check` is what CI runs; `pnpm lint` also fixes. `pnpm validate-feeds --skip-network` checks `feeds.yml` without probing avatars.

Health endpoints: `/healthcheck` (liveness), `/readyz` (database reachable), and `/status` (feeds, publishing backlog, relays, inbox results). See [docs/operations.md](docs/operations.md) for rollout notes and failure handling.

## Tech Stack

| Component          | Technology                                                                           |
| ------------------ | ------------------------------------------------------------------------------------ |
| Runtime            | TypeScript 6 / Node.js 26+                                                           |
| Web Framework      | [Next.js](https://nextjs.org/) 16 (App Router, standalone output)                    |
| UI                 | React 19, [Tailwind CSS](https://tailwindcss.com/) 4, [DaisyUI](https://daisyui.com/) 5 |
| ActivityPub        | [Fedify](https://fedify.dev/) 2.4 (`@fedify/fedify`, `@fedify/vocab`, `@fedify/next`) |
| KV, Queue & Tasks  | `@fedify/postgres`                                                                   |
| Database           | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/)                              |
| RSS Parsing        | `rss-parser`                                                                         |
| AI Hashtags        | Google Gemini via `@google/genai` (optional)                                         |
| Config Validation  | Zod v4                                                                               |
| Testing            | Vitest 5, `@fedify/testing`, `@fedify/lint`                                          |

## Project Structure

```
src/
  app/                Next.js App Router pages and API routes
    page.tsx          Homepage listing all bots
    bot/[username]/   Bot profile, followers, and following pages
    stats/            Global statistics dashboard
    status/           System status page
    healthcheck/      Health check endpoint
    nodeinfo/         NodeInfo protocol endpoint
    users/            WebFinger endpoint
  components/         Shared React components
  lib/
    config.ts         Zod-validated feeds.yml parser
    schema.ts         Drizzle ORM table definitions
    db.ts             Typed data access functions
    globals.ts        Singleton initialization (DB, federation, config)
    rss.ts            RSS/Atom feed fetcher and normalizer
    federation.ts     Fedify federation, actor dispatchers, inbox listeners
    publisher.ts      Dedup and store new entries with their delivery intent
    publications.ts   Retry queue submission of stored posts per inbox
    inbox-state.ts    Authorized, idempotent follow responses and reactions
    remote-fetch.ts   Public-address-only, size-bounded HTTP fetching
    maintenance.ts    Startup jobs as retried Fedify background tasks
    poller.ts         Interval-based polling loop with per-feed leases
    hashtags.ts       Hashtag extraction, normalization, optional Gemini AI tagging
    logging.ts        LogTape logging configuration
    __tests__/        Unit and integration tests
  proxy.ts            Fedify/ActivityPub request routing
  instrumentation.ts  Server startup: migrations, queue, poller
drizzle/              Generated SQL migration files (committed to git)
feeds.yml             Bot, follow, and relay configuration
feeds.schema.json     JSON Schema spec for feeds.yml
```

## Docker

The Dockerfile uses a multi-stage build: Next.js is compiled in the builder stage, then `.next/standalone` and `.next/static` are copied into the final `node:26-slim` image along with Drizzle migrations. `feeds.yml` is baked into the image — mount it as a volume to override.

## License

MIT
