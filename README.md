# robot.villas

An RSS-to-Mastodon bridge. Each RSS feed gets its own bot account on the fediverse, discoverable via WebFinger (e.g. `@hackernews@robot.villas`). Fediverse users can follow any bot from Mastodon or other ActivityPub-compatible platforms and receive new posts in their timeline.

## Configuration

Bots and relays are configured in `feeds.yml`:

```yaml
bots:
  hackernews:
    feed_url: "https://news.ycombinator.com/rss"
    display_name: "Hacker News"
    summary: "Top stories from Hacker News"
    profile_photo: "https://news.ycombinator.com/y18.svg"
relays:
  - https://relay.toot.io/actor
```

Each key under `bots` becomes the bot's fediverse username. Usernames must be lowercase alphanumeric or underscores (validated at startup via Zod).

| Field | Required | Description |
|---|---|---|
| `feed_url` | Yes | URL of the RSS/Atom feed |
| `display_name` | Yes | Display name shown on the profile (max 100 chars) |
| `summary` | Yes | Short bio/description (max 500 chars) |
| `profile_photo` | No | URL to an avatar image |

The `relays` list contains ActivityPub relay actor URLs. The server subscribes to these on startup so posts reach a wider audience.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | (required) |
| `DOMAIN` | Public domain for ActivityPub IDs and WebFinger | (required) |
| `PORT` | HTTP server port | `3000` |
| `POLL_INTERVAL_MS` | Milliseconds between RSS poll cycles | `300000` (5 min) |
| `BLOCKED_INSTANCES` | Comma-separated hostnames to reject Follows from | (none) |

## Development

```bash
nvm use
yarn install
export DATABASE_URL="postgres://user:password@localhost:5432/robot_villas"
export DOMAIN="robot.villas"
yarn dev
```

A running PostgreSQL instance is required. Migrations are applied automatically on startup.

## Scripts

| Command | Description |
|---|---|
| `yarn dev` | Dev server with hot-reload (tsx watch) |
| `yarn build` | Compile TypeScript to `dist/` |
| `yarn start` | Run compiled output (`node dist/index.js`) |
| `yarn test` | Run tests with Vitest |
| `yarn test:watch` | Run tests in watch mode |
| `yarn lint` | Lint with ESLint |
| `yarn typecheck` | Type-check without emitting |
| `yarn db:generate` | Generate Drizzle migration from schema changes |
| `yarn db:push` | Push schema directly to database (dev only) |
| `yarn db:studio` | Open Drizzle Studio database browser |

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | TypeScript / Node.js 24+ |
| Web Framework | [Hono](https://hono.dev/) |
| ActivityPub | [Fedify](https://fedify.dev/) v2 (`@fedify/fedify`, `@fedify/vocab`, `@fedify/hono`) |
| KV & Message Queue | `@fedify/postgres` |
| Database | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/) |
| RSS Parsing | `rss-parser` |
| Config Validation | Zod v4 |
| Testing | Vitest v4 |

## Project Structure

```
src/
  index.ts          Entry point: wires config, DB, federation, server, poller
  config.ts         Zod-validated feeds.yml parser
  schema.ts         Drizzle ORM table definitions (feed_entries, followers, actor_keypairs, relays)
  db.ts             Drizzle instance and typed data access functions
  rss.ts            RSS/Atom feed fetcher and normalizer
  federation.ts     Fedify federation, actor dispatchers, inbox listeners, relay subscriptions
  publisher.ts      Dedup + publish new entries as Create(Note) activities
  poller.ts         Interval-based polling loop
  server.ts         Hono app with Fedify middleware, homepage, and bot profile pages
  logging.ts        LogTape logging configuration
  __tests__/        Unit and integration tests
drizzle/            Generated SQL migration files (committed to git)
feeds.yml           Bot and relay configuration
```

## Docker

The Dockerfile uses a multi-stage build: TypeScript is compiled in the builder stage, then only `dist/` and production dependencies are copied into the final `node:24-slim` image. `feeds.yml` is baked into the image — mount it as a volume to override.

## License

MIT
