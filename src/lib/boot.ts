import type { Logger } from "@logtape/logtape";
import { migrateWithRetry, type Db } from "./db";

const globalForBoot = globalThis as unknown as {
  __robotVillasMigration?: Promise<void>;
};

/**
 * Migrates on startup, exiting if it keeps failing. Not in `instrumentation.ts`: that file is
 * also compiled for the Edge runtime, where `process.exit` is unsupported.
 */
export async function migrateOrExit(db: Db, logger: Logger): Promise<void> {
  try {
    // Share one in-flight migration across register() calls in this process.
    globalForBoot.__robotVillasMigration ??= migrateWithRetry(db, (attempt, delayMs, error) => {
      logger.warn("Migration attempt {attempt} failed, retrying in {delayMs}ms: {error}", {
        attempt,
        delayMs,
        error,
      });
    });
    await globalForBoot.__robotVillasMigration;
  } catch (err) {
    // Throwing leaves the process up and 500ing every request; exiting lets the
    // supervisor restart it.
    logger.fatal("Database migrations failed, exiting so the container restarts: {error}", {
      error: err,
    });
    process.exit(1);
  }
  logger.info("Database migrations complete");
}
