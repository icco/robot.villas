import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { like } from "drizzle-orm";
import { createFederation, MemoryKvStore, type Message, type MessageQueue } from "@fedify/fedify";
import { createDb, migrate } from "../db";
import { maintenanceRuns } from "../schema";

vi.mock("../federation", () => ({
  followAccounts: vi.fn(),
  repairFollowerInboxes: vi.fn(),
  sendDeletedBotActivities: vi.fn(),
  sendProfileUpdates: vi.fn(),
  subscribeToRelays: vi.fn(),
}));

import { defineMaintenanceTasks, MAINTENANCE_JOBS } from "../maintenance";

function recordingQueue(fail = false) {
  const messages: Message[] = [];
  const queue: MessageQueue = {
    async enqueue(message) {
      if (fail) {
        throw new Error("queue down");
      }
      messages.push(message as Message);
    },
    async listen() {},
  };
  return { queue, messages };
}

describe.skipIf(!process.env.DATABASE_URL)("startup maintenance tasks", () => {
  const client = postgres(process.env.DATABASE_URL ?? "postgres://unused");
  const db = createDb(client);
  beforeAll(() => migrate(db));
  beforeEach(() => db.delete(maintenanceRuns).where(like(maintenanceRuns.deployment, "test-%")));
  afterAll(() => client.end());

  // Each call is a fresh process: new KV store, so Fedify's own one-hour
  // deduplication cannot help and only the database record prevents repeats.
  function start(fail = false) {
    const outbox = recordingQueue();
    const tasks = recordingQueue(fail);
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      queue: { inbox: outbox.queue, outbox: outbox.queue, fanout: outbox.queue, task: tasks.queue },
      taskQueueResolution: "strict",
      manuallyStartQueue: true,
    });
    const enqueue = defineMaintenanceTasks(federation, db, { bots: {} } as never);
    const ctx = federation.createContext(new URL("https://robot.test"));
    return { run: (deployment: string) => enqueue(ctx, deployment), tasks, outbox };
  }

  it("enqueues each job once per deployment across restarts, on the task queue", async () => {
    const first = start();
    await first.run("test-a");
    expect(first.tasks.messages).toHaveLength(MAINTENANCE_JOBS.length);
    expect(first.outbox.messages).toHaveLength(0);
    const restarted = start();
    await restarted.run("test-a");
    expect(restarted.tasks.messages).toHaveLength(0);
    await restarted.run("test-b");
    expect(restarted.tasks.messages).toHaveLength(MAINTENANCE_JOBS.length);
  });

  it("releases the claim when enqueueing fails so a later start retries", async () => {
    await expect(start(true).run("test-c")).rejects.toThrow(/queue down/);
    const retry = start();
    await retry.run("test-c");
    expect(retry.tasks.messages).toHaveLength(MAINTENANCE_JOBS.length);
  });
});
