import { PostgresKvStore, PostgresMessageQueue } from "@fedify/postgres";
import postgres from "postgres";
import { loadConfig, resolveBlockedInstances } from "./config";
import { createDb } from "./db";
import { setupFederation } from "./federation";
import { defineMaintenanceTasks } from "./maintenance";

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

  // Bounded connect time so readiness probes and startup fail fast during an outage.
  const sql = postgres(databaseUrl, { connect_timeout: 10 });
  const db = createDb(sql);
  const config = loadConfig("feeds.yml");
  const kvStore = new PostgresKvStore(sql);
  const messageQueue = new PostgresMessageQueue(sql);
  const taskQueue = new PostgresMessageQueue(sql, {
    tableName: "fedify_task_message_v2",
    channelName: "fedify_task_channel",
  });
  const blockedInstances = resolveBlockedInstances(config);
  const federation = setupFederation({
    config,
    db,
    kvStore,
    messageQueue,
    taskQueue,
    origin: `https://${domain}`,
    blockedInstances,
  });
  const enqueueStartupMaintenance = defineMaintenanceTasks(federation, db, config);
  return { sql, db, config, federation, kvStore, messageQueue, domain, enqueueStartupMaintenance };
}

export function getGlobals(): Globals {
  if (!globalForApp.__robotVillas) {
    globalForApp.__robotVillas = initGlobals();
  }
  return globalForApp.__robotVillas;
}
