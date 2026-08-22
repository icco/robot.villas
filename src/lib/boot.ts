import type { Logger } from "@logtape/logtape";
import { migrateWithRetry, type Db } from "./db";

const globalForBoot = globalThis as unknown as {
  __robotVillasMigration?: Promise<void>;
};

/**
 * Migrates on startup, exiting the process if the database stays unreachable. Lives here
 * rather than in `instrumentation.ts` because that file is also compiled for the Edge
 * runtime, where `process.exit` is unsupported.
 */
export async function migrateOrExit(db: Db, logger: Logger): Promise<void> {
  try {
    // Next re-runs register() per request until it succeeds. Pin the promise so the retry
    // window can't put two migrations in flight at once.
    globalForBoot.__robotVillasMigration ??= migrateWithRetry(db, (attempt, delayMs, error) => {
      logger.warn("Migration attempt {attempt} failed, retrying in {delayMs}ms: {error}", {
        attempt,
        delayMs,
        error,
      });
    });
    await globalForBoot.__robotVillasMigration;
  } catch (err) {
    // Throwing would leave the process up and 500ing every request, so `restart: always`
    // never fires. Exit and let Docker restart us.
    logger.fatal("Database migrations failed, exiting so the container restarts: {error}", {
      error: err,
    });
    process.exit(1);
  }
  logger.info("Database migrations complete");
}
