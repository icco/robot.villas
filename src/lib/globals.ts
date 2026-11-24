import { PostgresKvStore, PostgresMessageQueue } from "@fedify/postgres";
import { getLogger } from "@logtape/logtape";
import { Redis } from "ioredis";
import postgres from "postgres";
import { getWebmentionBots, loadConfig, resolveBlockedInstances } from "./config";
import { createDb } from "./db";
import { setupFederation } from "./federation";
import { defineMaintenanceTasks } from "./maintenance";
import { MemoryResponseStore, RedisResponseStore, type ResponseStore } from "./response-cache";
import { defineWebmentionTasks } from "./webmentions";

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

function createResponseStore(redisUrl: string | undefined): ResponseStore {
  if (!redisUrl) {
    return new MemoryResponseStore({ max: 5_000 });
  }
  // Fail fast while Redis is down so fetches fall through to the database instead of queueing.
  const redis = new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 0, commandTimeout: 500, connectTimeout: 2_000 });
  redis.on("error", (error) => getLogger(["robot-villas", "response-cache"]).warn("Redis error: {error}", { error }));
  return new RedisResponseStore(redis);
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
  defineWebmentionTasks(federation, { db, kv: kvStore, domain, botUsernames: Object.keys(config.bots), webmentionBots: getWebmentionBots(config) });
  const responseStore = createResponseStore(process.env.REDIS_URL);
  return { sql, db, config, federation, kvStore, messageQueue, domain, enqueueStartupMaintenance, responseStore };
}

export function getGlobals(): Globals {
  if (!globalForApp.__robotVillas) {
    globalForApp.__robotVillas = initGlobals();
  }
  return globalForApp.__robotVillas;
}
