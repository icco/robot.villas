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
| `default_hashtags` | No       | Up to 3 default hashtags (no leading `#`)            |

The `follows` list contains fediverse handles (`@user@instance`) that every bot will send a Follow to on startup.

The `relays` list contains ActivityPub relay actor URLs. The server subscribes to these on startup so posts reach a wider audience.

## Environment Variables

| Variable            | Description                                      | Default            |
| ------------------- | ------------------------------------------------ | ------------------ |
| `DATABASE_URL`      | PostgreSQL connection string                     | (required)         |
| `DOMAIN`            | Public domain for ActivityPub IDs and WebFinger  | (required)         |
| `PORT`              | HTTP server port                                 | `3000`             |
| `POLL_INTERVAL_MS`  | Milliseconds between RSS poll cycles             | `300000` (5 min)   |
| `BLOCKED_INSTANCES` | Comma-separated hostnames to reject Follows from | (none)             |
| `GEMINI_API_KEY`    | Google Gemini API key for AI hashtag suggestions | (none)             |
| `GEMINI_PROJECT`    | GCP project for Vertex AI (alternative to key)   | (none)             |
| `GEMINI_LOCATION`   | GCP region for Vertex AI                         | `us-central1`     |
| `GEMINI_MODEL`      | Gemini model name                                | `gemini-2.5-flash` |

## Development

```bash
nvm use
yarn install
export DATABASE_URL="postgres://user:password@localhost:5432/robot_villas"
export DOMAIN="robot.villas"
yarn dev
```

A running PostgreSQL instance is required. Migrations are applied automatically on startup.

## Tech Stack

| Component          | Technology                                                                           |
| ------------------ | ------------------------------------------------------------------------------------ |
| Runtime            | TypeScript 6 / Node.js 24+                                                           |
| Web Framework      | [Next.js](https://nextjs.org/) 15 (App Router, standalone output)                    |
| UI                 | React 19, [Tailwind CSS](https://tailwindcss.com/) 4, [DaisyUI](https://daisyui.com/) 5 |
| ActivityPub        | [Fedify](https://fedify.dev/) v2 (`@fedify/fedify`, `@fedify/vocab`, `@fedify/next`) |
| KV & Message Queue | `@fedify/postgres`                                                                   |
| Database           | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/)                              |
| RSS Parsing        | `rss-parser`                                                                         |
| AI Hashtags        | Google Gemini via `@google/genai` (optional)                                         |
| Config Validation  | Zod v4                                                                               |
| Testing            | Vitest v4                                                                            |

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
    publisher.ts      Dedup + publish new entries as Create(Note) activities
    poller.ts         Interval-based polling loop
    hashtags.ts       Hashtag extraction, normalization, optional Gemini AI tagging
    logging.ts        LogTape logging configuration
    __tests__/        Unit and integration tests
  middleware.ts       Fedify/ActivityPub request routing
  instrumentation.ts  Server startup: migrations, queue, poller
drizzle/              Generated SQL migration files (committed to git)
feeds.yml             Bot, follow, and relay configuration
feeds.schema.json     JSON Schema spec for feeds.yml
```

## Docker

The Dockerfile uses a multi-stage build: Next.js is compiled in the builder stage, then `.next/standalone` and `.next/static` are copied into the final `node:25-slim` image along with Drizzle migrations. `feeds.yml` is baked into the image — mount it as a volume to override.

## License

MIT
