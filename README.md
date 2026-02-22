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
  lobsters:
    feed_url: "https://lobste.rs/rss"
    display_name: "Lobsters"
    summary: "Stories from Lobsters"
```

Each key under `bots` becomes the bot's username on the instance.

## Tech Stack

| Component | Technology |
|---|---|
| Language / Runtime | TypeScript / Node.js |
| ActivityPub | [Fedify](https://fedify.dev/) v2 (`@fedify/fedify`) |
| KvStore & MessageQueue | `@fedify/postgres` |
| Database | PostgreSQL |
| RSS Parsing | `rss-parser` (or similar) |

## Development Setup

```bash
# Install dependencies
yarn install

# Set required environment variables (see below)
export DATABASE_URL="postgres://user:password@localhost:5432/robot_villas"
export DOMAIN="robot.villas"

# Start the development server
yarn dev
```

A running PostgreSQL instance is required. The application will apply any necessary schema migrations on startup.

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `DOMAIN` | Public domain the server is running on (used for ActivityPub IDs and WebFinger) |

## Best Practices

### Tooling

- **Node.js version** is pinned in `.nvmrc` (Node 24 LTS). Use `nvm use` to switch automatically.
- **Linting** uses ESLint 10 with the flat config format (`eslint.config.mjs`) and `typescript-eslint`. Run `npm run lint` before committing.
- **TypeScript** should be compiled with `strict: true` to catch null/undefined issues early — especially important for network-heavy bot code.
- Use `"type": "module"` in `package.json` and write all source files as ES modules (`.ts` with `import`/`export`).

### Adding a New Bot

- Add a new entry under `bots:` in `feeds.yml`. The key becomes the bot's fediverse username (e.g. `lobsters` → `@lobsters@robot.villas`).
- Keep usernames short, lowercase, and URL-safe (no spaces or special characters).
- Provide a meaningful `display_name` and `summary` — these appear on the bot's fediverse profile.

### Feed Polling & Deduplication

- Use the RSS entry `guid` (or a hash of `link` + `title`) as the deduplication key stored in PostgreSQL — never rely on publish dates alone, as feeds often backfill or reorder items.
- Poll feeds no more frequently than once every 15 minutes to be a good citizen toward feed providers.
- Handle HTTP errors and malformed XML gracefully; log and skip bad entries rather than crashing.

### ActivityPub

- Every actor (bot) needs a persistent RSA key pair for [HTTP Signatures](https://docs.joinmastodon.org/spec/security/). Generate and store keys once at actor creation time, not on every request.
- Always respond to `Follow` activities with an `Accept` sent to the sender's inbox, or followers will never actually subscribe.
- Handle `Undo(Follow)` to remove followers from the database and avoid delivering to dead inboxes.
- Sign all outgoing `POST` requests to remote inboxes; unsigned deliveries will be rejected by Mastodon and most other servers.
- Set `Content-Type: application/activity+json` on all ActivityPub endpoints.

### Error Handling & Reliability

- Wrap inbox handlers in try/catch and return `202 Accepted` quickly — remote servers time out after a few seconds.
- Use a message queue (via `@fedify/postgres`) for outbound deliveries so a slow or unreachable server does not block the polling loop.
- Retry failed deliveries with exponential backoff; permanently remove unreachable inboxes after repeated failures.

## Implementation Roadmap

- [ ] Project scaffolding (TypeScript, `package.json`, `tsconfig.json`)
- [ ] `feeds.yml` schema and parser
- [ ] PostgreSQL schema (feed entry history table)
- [ ] Fedify federation setup with one Actor per bot
- [ ] RSS feed polling and parsing
- [ ] Publishing new entries as ActivityPub Notes
- [ ] WebFinger support for bot discovery
- [ ] Follower management (accept Follow requests)
- [ ] Dockerfile for production deployment
- [ ] Scheduled polling (cron or interval-based)

## License

MIT
