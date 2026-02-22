import { serve } from "@hono/node-server";
import { PostgresKvStore, PostgresMessageQueue } from "@fedify/postgres";
import postgres from "postgres";
import { loadConfig } from "./config.js";
import { migrate } from "./db.js";
import { setupFederation } from "./federation.js";
import { startPoller } from "./poller.js";
import { createApp } from "./server.js";

const DATABASE_URL = process.env.DATABASE_URL;
const DOMAIN = process.env.DOMAIN;
const PORT = parseInt(process.env.PORT || "3000", 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "300000", 10);

if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

if (!DOMAIN) {
  console.error("DOMAIN environment variable is required");
  process.exit(1);
}

const config = loadConfig("feeds.yml");
const sql = postgres(DATABASE_URL);

await migrate(sql);

const kvStore = new PostgresKvStore(sql);
const messageQueue = new PostgresMessageQueue(sql);

const fed = setupFederation({ config, sql, kvStore, messageQueue });
const app = createApp(fed);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`robot.villas listening on http://localhost:${info.port}`);
});

const poller = startPoller({
  config,
  sql,
  domain: DOMAIN,
  intervalMs: POLL_INTERVAL_MS,
  getContext: () => fed.createContext(new URL(`https://${DOMAIN}`)),
});

function shutdown() {
  console.log("Shutting down...");
  poller.stop();
  server.close();
  sql.end().then(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
