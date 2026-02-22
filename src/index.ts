import { serve } from "@hono/node-server";
import { PostgresKvStore, PostgresMessageQueue } from "@fedify/postgres";
import { getLogger } from "@logtape/logtape";
import postgres from "postgres";
import { behindProxy } from "x-forwarded-fetch";
import { getBlockedInstances, loadConfig } from "./config.js";
import { createDb, ensureTables } from "./db.js";
import { setupFederation } from "./federation.js";
import { setupLogging } from "./logging.js";
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

await setupLogging();
const logger = getLogger(["robot-villas", "server"]);

const config = loadConfig("feeds.yml");
const sql = postgres(DATABASE_URL);
const db = createDb(sql);

await ensureTables(sql);

const kvStore = new PostgresKvStore(sql);
const messageQueue = new PostgresMessageQueue(sql);

const blockedInstances = getBlockedInstances();
const fed = setupFederation({ config, db, kvStore, messageQueue, blockedInstances });
const app = createApp(fed, config, DOMAIN, db);

const queueController = new AbortController();
fed.startQueue(undefined, { signal: queueController.signal });
logger.info("Fedify message queue worker started");

const server = serve(
  { fetch: behindProxy(app.fetch.bind(app)), port: PORT },
  (info) => {
    logger.info("Listening on http://localhost:{port}", { port: info.port });
  },
);

const poller = startPoller({
  config,
  db,
  domain: DOMAIN,
  intervalMs: POLL_INTERVAL_MS,
  getContext: () => fed.createContext(new URL(`https://${DOMAIN}`)),
});

function shutdown() {
  logger.info("Shutting down...");
  poller.stop();
  queueController.abort();
  server.close();
  sql.end().then(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
