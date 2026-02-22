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
