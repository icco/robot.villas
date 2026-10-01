export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { getGlobals } = await import("@/lib/globals");
  const globals = getGlobals();
  const { db, federation, config, domain, enqueueStartupMaintenance } = globals;

  const { setupLogging } = await import("@/lib/logging");
  await setupLogging();

  const { getLogger } = await import("@logtape/logtape");
  const logger = getLogger(["robot-villas", "server"]);

  const { migrateOrExit } = await import("@/lib/boot");
  await migrateOrExit(db, logger);

  if (process.env.DISABLE_BACKGROUND === "true") {
    logger.info(
      "DISABLE_BACKGROUND=true: skipping queue, federation tasks, and poller",
    );
    return;
  }

  federation.startQueue();
  logger.info("Fedify message queue worker started");

  const fedCtx = federation.createContext(new URL(`https://${domain}`));
  // A new image or config produces a new key, so changed config re-runs the jobs.
  const { createHash } = await import("node:crypto");
  const deployment = createHash("sha256")
    .update(process.env.SOURCE_COMMIT ?? process.env.GIT_SHA ?? "")
    .update(JSON.stringify(config))
    .digest("hex")
    .slice(0, 16);
  enqueueStartupMaintenance(fedCtx, deployment).catch((err) => {
    logger.error("Could not enqueue maintenance jobs: {error}", { error: err });
  });

  const { startPoller } = await import("@/lib/poller");
  const { parsePositiveInt } = await import("@/lib/env");
  const pollConcurrency = parsePositiveInt(process.env.POLL_CONCURRENCY, 10);

  startPoller({
    config,
    db,
    domain,
    concurrency: pollConcurrency,
    getContext: () => federation.createContext(new URL(`https://${domain}`)),
  });

  logger.info("RSS poller started");
}
