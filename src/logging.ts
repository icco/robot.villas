import { AsyncLocalStorage } from "node:async_hooks";
import { configure, getConsoleSink } from "@logtape/logtape";

export async function setupLogging(): Promise<void> {
  await configure({
    sinks: { console: getConsoleSink() },
    loggers: [
      { category: "robot-villas", sinks: ["console"], lowestLevel: "debug" },
      { category: "fedify", sinks: ["console"], lowestLevel: "info" },
    ],
    contextLocalStorage: new AsyncLocalStorage(),
  });
}
