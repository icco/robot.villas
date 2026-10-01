import type { Context, Federation } from "@fedify/fedify";
import { createExponentialBackoffPolicy } from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { maintenanceRuns } from "./schema";
import type { FeedsConfig } from "./config";
import type { Db } from "./db";
import {
  followAccounts,
  repairFollowerInboxes,
  sendDeletedBotActivities,
  sendProfileUpdates,
  subscribeToRelays,
} from "./federation";

const logger = getLogger(["robot-villas", "maintenance"]);

export const MAINTENANCE_JOBS = [
  "repairFollowerInboxes",
  "subscribeToRelays",
  "followAccounts",
  "sendProfileUpdates",
  "sendDeletedBotActivities",
] as const;
export type MaintenanceJob = (typeof MAINTENANCE_JOBS)[number];

/**
 * Startup maintenance runs as named, retried Fedify tasks instead of
 * fire-and-forget promises, so it survives restarts and replicas do not each
 * run it. Must be called before `startQueue()`.
 */
export function defineMaintenanceTasks(federation: Federation<void>, db: Db, config: FeedsConfig) {
  const jobs: Record<MaintenanceJob, (ctx: Context<void>) => Promise<void>> = {
    repairFollowerInboxes: (ctx) => repairFollowerInboxes(ctx, db, Object.keys(config.bots)),
    subscribeToRelays: (ctx) => subscribeToRelays(ctx, db, config),
    followAccounts: (ctx) => followAccounts(ctx, db, config),
    sendProfileUpdates: (ctx) => sendProfileUpdates(ctx, db, config),
    sendDeletedBotActivities: (ctx) => sendDeletedBotActivities(ctx, db, config),
  };
  const task = federation.defineTask("maintenance.v1", {
    schema: z.object({ job: z.enum(MAINTENANCE_JOBS), deployment: z.string().max(200) }),
    retryPolicy: createExponentialBackoffPolicy({ maxAttempts: 5 }),
    handler: async (ctx, { job }) => {
      logger.info("Running maintenance job {job}", { job });
      await jobs[job](ctx);
    },
    onError: (_ctx, error, data) => {
      logger.error("Maintenance job {job} failed: {error}", { job: data?.job, error });
    },
  });

  /**
   * Once per deployment: a database row claims each job durably (the queue's
   * own deduplication only lasts an hour), and is removed if enqueueing fails
   * so a later start can retry.
   */
  return async function enqueueStartupMaintenance(ctx: Context<void>, deployment: string): Promise<void> {
    for (const job of MAINTENANCE_JOBS) {
      const claimed = await db.insert(maintenanceRuns).values({ deployment, job }).onConflictDoNothing()
        .returning({ job: maintenanceRuns.job });
      if (claimed.length === 0) {
        continue;
      }
      try {
        await ctx.enqueueTask(task, { job, deployment }, { deduplicationKey: `${deployment}:${job}` });
      } catch (error) {
        await db.delete(maintenanceRuns).where(and(eq(maintenanceRuns.deployment, deployment), eq(maintenanceRuns.job, job)));
        throw error;
      }
    }
  };
}
