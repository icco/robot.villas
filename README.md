# robot.villas

robot.villas is an RSS-to-Mastodon bridge. It reads RSS feeds and publishes their entries as posts on the fediverse (Mastodon-compatible networks) using the ActivityPub protocol. Each RSS feed gets its own bot account that followers can subscribe to from any fediverse platform.

## How It Works

- A single `feeds.yml` config file defines bots and their associated RSS feeds.
- Each bot is an ActivityPub Actor discoverable via WebFinger (e.g. `@hackernews@robot.villas`).
- A scheduled job polls RSS feeds and creates posts (ActivityPub Notes) for new entries.
- Post history is tracked in PostgreSQL to avoid publishing duplicates.
- Fediverse users can follow any bot from Mastodon or other ActivityPub-compatible platforms.

## Configuration

Bots are configured in a `feeds.yml` file at the root of the project:

```yaml
bots:
  hackernews:
    feed_url: "https://news.ycombinator.com/rss"
    display_name: "Hacker News"
    summary: "Top stories from Hacker News"
    profile_photo: "https://news.ycombinator.com/y18.svg"
  lobsters:
    feed_url: "https://lobste.rs/rss"
    display_name: "Lobsters"
    summary: "Stories from Lobsters"
    profile_photo: "https://lobste.rs/apple-touch-icon-144.png"
```

Each key under `bots` becomes the bot's username on the instance. Usernames must be lowercase alphanumeric or underscores (validated at startup via Zod).

| Field | Required | Description |
|---|---|---|
| `feed_url` | Yes | URL of the RSS/Atom feed |
| `display_name` | Yes | Display name shown on the profile (max 100 chars) |
| `summary` | Yes | Short bio/description (max 500 chars) |
| `profile_photo` | No | URL to an avatar image, used as the ActivityPub actor icon and shown on the profile page |

## Tech Stack

| Component | Technology |
|---|---|
| Language / Runtime | TypeScript / Node.js 24+ |
| Web Framework | [Hono](https://hono.dev/) |
| ActivityPub | [Fedify](https://fedify.dev/) v2 (`@fedify/fedify`, `@fedify/vocab`, `@fedify/hono`) |
| KvStore & MessageQueue | `@fedify/postgres` |
| Database | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/) |
| RSS Parsing | `rss-parser` |
| Config Validation | Zod v4 |
| Testing | Vitest v4 |
| CI | GitHub Actions |

## Development Setup

```bash
# Use the correct Node version
nvm use

# Install dependencies
yarn install

# Set required environment variables (see below)
export DATABASE_URL="postgres://user:password@localhost:5432/robot_villas"
export DOMAIN="robot.villas"

# Start the development server (hot-reload via tsx)
yarn dev
```

A running PostgreSQL instance is required. The application will apply any necessary schema migrations on startup.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | (required) |
| `DOMAIN` | Public domain the server is running on (used for ActivityPub IDs and WebFinger) | (required) |
| `PORT` | HTTP server port | `3000` |
| `POLL_INTERVAL_MS` | Milliseconds between RSS poll cycles | `300000` (5 min) |
| `BLOCKED_INSTANCES` | Comma-separated instance hostnames to reject Follows from (e.g. `spam.example,bad.example`) | (none) |

## Scripts

| Command | Description |
|---|---|
| `yarn dev` | Start dev server with hot-reload (tsx watch) |
| `yarn build` | Compile TypeScript to `dist/` |
| `yarn start` | Run compiled output (`node dist/index.js`) |
| `yarn test` | Run tests with Vitest |
| `yarn test:watch` | Run tests in watch mode |
| `yarn lint` | Lint with ESLint |
| `yarn typecheck` | Type-check without emitting |
| `yarn db:generate` | Generate Drizzle migration from schema changes |
| `yarn db:push` | Push schema directly to database (dev only) |
| `yarn db:studio` | Open Drizzle Studio database browser |

## Project Structure

```
src/
  index.ts          Entry point: wires config, DB, federation, server, poller
  config.ts         Zod-validated feeds.yml parser
  schema.ts         Drizzle ORM table definitions
  db.ts             Drizzle instance creation and typed data access functions
  rss.ts            RSS/Atom feed fetcher and normalizer
  federation.ts     Fedify federation, actor dispatchers, inbox listeners
  publisher.ts      Dedup + publish new entries as Create(Note) activities
  poller.ts         Interval-based polling loop
  server.ts         Hono app with Fedify middleware, homepage, and bot profile pages
  __tests__/        Unit and integration tests
drizzle/            Generated SQL migration files (committed to git)
```

## Best Practices

### Tooling

- **Node.js version** is pinned in `.nvmrc` (Node 24). Use `nvm use` to switch automatically.
- **Linting** uses ESLint with the flat config format and `typescript-eslint`. Run `yarn lint` before committing.
- **TypeScript** is compiled with `strict: true` to catch null/undefined issues early -- especially important when working with Fedify's nullable ActivityPub fields.
- Use `"type": "module"` in `package.json` and write all source files as ES modules with `import`/`export`.

### Adding a New Bot

- Add a new entry under `bots:` in `feeds.yml`. The key becomes the bot's fediverse username (e.g. `lobsters` -> `@lobsters@robot.villas`).
- Usernames must be lowercase alphanumeric or underscores -- this is enforced by Zod validation at startup.
- Provide a meaningful `display_name` and `summary` -- these appear on the bot's fediverse profile.
- Optionally set `profile_photo` to a URL pointing to an avatar image. This is served as the ActivityPub actor `icon` (visible in Mastodon etc.) and displayed on the bot's HTML profile page at `/@username`.
- No restart is needed for key generation; key pairs are created lazily on first actor dispatch and persisted in the `actor_keypairs` table.

### Fedify v2 Notes

- Fedify v2 splits vocabulary classes into `@fedify/vocab` (was `@fedify/fedify/vocab`) and framework integration into separate packages like `@fedify/hono` (was `@fedify/fedify/x/hono`). Import accordingly.
- Fedify uses the TC39 `Temporal` API for timestamps (e.g. `Temporal.Instant` for the `published` field on Notes). Since Node.js does not ship Temporal natively yet, the `@js-temporal/polyfill` package is required. Fedify itself imports from this polyfill, so use the same package for consistency.
- The `sendActivity` method accepts the string `"followers"` as a recipient, which requires a registered followers collection dispatcher. This is simpler than iterating over followers manually.
- Bot actors use the `Application` type (not `Person`) since they are automated accounts. This is the ActivityPub convention for bots.
- The followers collection dispatcher must return objects satisfying the `Recipient` interface (`{ id, inboxId, endpoints }`). When you only have follower URIs stored in the database, you can return `{ id: new URL(uri), inboxId: null, endpoints: null }` and Fedify will resolve the inbox by dereferencing the actor.
- **Message queue startup**: `createFederation` is called with `manuallyStartQueue: true`, and the queue worker is explicitly started via `fed.startQueue()` with an `AbortController` signal for graceful shutdown. The default auto-start mode (`manuallyStartQueue: false`) is fragile with `PostgresMessageQueue` — if the first enqueue races with table initialization, the queue can silently fail to start and no outbound activities (Accept, Create) are ever delivered. Explicit startup avoids this entirely.
- **Dual cryptographic keys**: Each bot generates both `RSASSA-PKCS1-v1_5` (RSA) and `Ed25519` key pairs via `setKeyPairsDispatcher`. Fedify v2 defaults to `rfc9421` (HTTP Message Signatures) for `firstKnock`, which works best with Ed25519. Having only RSA may cause extra round-trips or failures with servers that prefer the newer spec. Both key pairs are stored as an array of JWKs in the `actor_keypairs` table and the dispatcher handles backward-compatible reads from the legacy single-JWK format.

### Database & Drizzle ORM

- The database schema is defined in `src/schema.ts` using Drizzle's TypeScript API. All queries in `db.ts` use Drizzle's type-safe query builder -- no raw SQL strings.
- Drizzle ORM uses the same `postgres` (postgres.js) driver that `@fedify/postgres` depends on. A single postgres.js client is created in `index.ts` and shared between Drizzle and Fedify's `PostgresKvStore`/`PostgresMessageQueue`, so there is one connection pool for the whole application.
- Migrations are generated with `yarn db:generate` and committed to the `drizzle/` directory. In production, `migrate()` from `drizzle-orm/postgres-js/migrator` applies pending migrations on startup.
- For local development, `yarn db:push` can push schema changes directly to the database without generating migration files.
- When modifying the schema, edit `src/schema.ts`, then run `yarn db:generate` to create a new migration file. Review the generated SQL before committing.

### Feed Polling & Deduplication

- The RSS entry `guid` is used as the primary dedup key, falling back to `link` then `title` for feeds that omit it. This is handled in `rss.ts`'s `normalizeFeedItem`.
- Both RSS 2.0 and Atom feeds are supported. Note that `rss-parser` maps the Atom `<id>` element to `item.id` (not `item.guid`), so the normalizer checks both fields.
- Entries are recorded in the `feed_entries` table before sending activities. If delivery fails, the entry is still marked as seen to avoid duplicate posts on retry. This is a deliberate trade-off: missed posts are better than duplicate posts on the fediverse.
- The default polling interval is 5 minutes. Tune `POLL_INTERVAL_MS` based on feed update frequency.

### ActivityPub

- Every actor (bot) needs persistent key pairs for HTTP Signatures. Both RSA and Ed25519 key pairs are generated lazily via Fedify's `setKeyPairsDispatcher` and stored as JWK arrays in the `actor_keypairs` table.
- Actors expose `followers` (pointing to the followers collection URI), `endpoints.sharedInbox` (the shared inbox URI for efficient batch delivery), and `assertionMethods` (Multikey format, per [FEP-521a](https://codeberg.org/fediverse/fep/src/branch/main/fep/521a/fep-521a.md)) alongside the legacy `publicKeys` (CryptographicKey format). Both key representation formats are needed for compatibility with servers that support only the older or newer spec.
- Always respond to `Follow` activities with an `Accept` sent to the sender's inbox, or followers will never actually subscribe.
- Handle `Undo(Follow)` to remove followers from the database and avoid delivering to dead inboxes.
- New entries are wrapped in `Create(Note)` activities (not sent as bare `Note`), which is what Mastodon and other implementations expect for timeline display.
- Fedify handles HTTP Signatures, content negotiation, and WebFinger automatically when you use its actor dispatcher and `sendActivity` API. You do not need to implement these manually.

### Error Handling & Reliability

- The poller wraps each bot's poll cycle in try/catch so that a failure in one feed does not block others. It logs at startup, on each cycle start/completion, and for every feed fetch (including entry counts), making it easy to verify it is running from container logs.
- The Follow inbox handler logs at each decision point (missing fields, unknown bot, failed actor resolution, blocked instance, successful accept) so silent failures are visible in production.
- Use `@fedify/postgres` for both `KvStore` and `MessageQueue` so that Fedify's outbound deliveries are persisted and survive restarts.
- The application performs graceful shutdown on SIGTERM/SIGINT: stops the poller, aborts the message queue worker (via `AbortController`), closes the HTTP server, and ends the database connection.

### Testing

- Tests use Vitest with `vi.mock()` for isolating modules (e.g. publisher tests mock the database layer).
- Database integration tests (in `db.test.ts`) require a `DATABASE_URL` environment variable and skip gracefully when it is not set. In CI, a PostgreSQL service container provides the database.
- RSS tests use inline XML fixtures rather than hitting real feeds, making them fast and deterministic.
- Run `yarn test` locally (config/RSS/publisher tests work without Postgres) and rely on CI for the full suite including database tests.

### Docker

- The Dockerfile uses a multi-stage build: compile TypeScript in the builder stage, then copy only `dist/` and production dependencies into the final `node:24-slim` image.
- `feeds.yml` is copied into the image. To change bot configuration, rebuild the image or mount the file as a volume.

### Debugging with `fedify` CLI

The [`fedify` CLI](https://fedify.dev/cli) is useful for manual testing and debugging of the ActivityPub integration:

- `fedify lookup @hackernews@robot.villas` — Verify an actor's properties (check that `followers`, `endpoints`, `assertionMethods`, and `publicKey` are all present).
- `fedify inbox -f @hackernews@robot.villas` — Spin up a temporary inbox and send a Follow to the bot. Watch the logs for the Accept response to verify the Follow/Accept round-trip works end to end.
- `fedify node info https://robot.villas/` — Check the NodeInfo response for the instance.

## License

MIT
