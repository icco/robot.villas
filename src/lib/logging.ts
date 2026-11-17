import { AsyncLocalStorage } from "node:async_hooks";
import {
  configure,
  getConsoleSink,
  jsonLinesFormatter,
} from "@logtape/logtape";

export async function setupLogging(): Promise<void> {
  await configure({
    sinks: { console: getConsoleSink({ formatter: jsonLinesFormatter }) },
    loggers: [
      { category: "robot-villas", sinks: ["console"], lowestLevel: "debug" },
      { category: ["fedify", "federation", "outbox"], sinks: ["console"], lowestLevel: "debug", parentSinks: "override" },
      { category: "fedify", sinks: ["console"], lowestLevel: "info" },
      // One line per HTTP request duplicates the reverse proxy's access log.
      { category: ["fedify", "federation", "http"], lowestLevel: "warning" },
    ],
    contextLocalStorage: new AsyncLocalStorage(),
  });
}
