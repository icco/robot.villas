import { describe, expect, it, vi } from "vitest";
import { createFederation, MemoryKvStore, type Message, type MessageQueue } from "@fedify/fedify";

vi.mock("../federation", () => ({
  followAccounts: vi.fn(),
  repairFollowerInboxes: vi.fn(),
  sendDeletedBotActivities: vi.fn(),
  sendProfileUpdates: vi.fn(),
  subscribeToRelays: vi.fn(),
}));

import { defineMaintenanceTasks, MAINTENANCE_JOBS } from "../maintenance";

function recordingQueue() {
  const messages: Message[] = [];
  const queue: MessageQueue = {
    async enqueue(message) {
      messages.push(message as Message);
    },
    async listen() {},
  };
  return { queue, messages };
}

describe("startup maintenance tasks", () => {
  it("enqueues each job once per deployment, on the dedicated task queue", async () => {
    const outbox = recordingQueue();
    const tasks = recordingQueue();
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      queue: { inbox: outbox.queue, outbox: outbox.queue, fanout: outbox.queue, task: tasks.queue },
      taskQueueResolution: "strict",
      manuallyStartQueue: true,
    });
    const enqueue = defineMaintenanceTasks(federation, {} as never, { bots: {} } as never);
    const ctx = federation.createContext(new URL("https://robot.test"));
    await enqueue(ctx, "deploy-a");
    await enqueue(ctx, "deploy-a");
    expect(tasks.messages).toHaveLength(MAINTENANCE_JOBS.length);
    expect(outbox.messages).toHaveLength(0);
    await enqueue(ctx, "deploy-b");
    expect(tasks.messages).toHaveLength(MAINTENANCE_JOBS.length * 2);
  });
});
