import { PostgresKvStore, PostgresMessageQueue } from "@fedify/postgres";
import postgres from "postgres";
import { getBlockedInstances, loadConfig } from "./config";
import { createDb } from "./db";
import { setupFederation } from "./federation";

type Globals = ReturnType<typeof initGlobals>;

const globalForApp = globalThis as unknown as {
  __robotVillas?: Globals;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

function initGlobals() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const domain = requireEnv("DOMAIN");

  const sql = postgres(databaseUrl);
  const db = createDb(sql);
  const config = loadConfig("feeds.yml");
  const kvStore = new PostgresKvStore(sql);
  const messageQueue = new PostgresMessageQueue(sql);
  const blockedInstances = getBlockedInstances();
  const federation = setupFederation({
    config,
    db,
    kvStore,
    messageQueue,
    origin: `https://${domain}`,
    blockedInstances,
  });
  return { sql, db, config, federation, kvStore, messageQueue, domain };
}

export function getGlobals(): Globals {
  if (!globalForApp.__robotVillas) {
    globalForApp.__robotVillas = initGlobals();
  }
  return globalForApp.__robotVillas;
}
