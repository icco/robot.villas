export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { getGlobals } = await import("@/lib/globals");
  const globals = getGlobals();
  const { db, federation, config, domain } = globals;

  const { setupLogging } = await import("@/lib/logging");
  await setupLogging();

  const { getLogger } = await import("@logtape/logtape");
  const logger = getLogger(["robot-villas", "server"]);

  const { migrate } = await import("@/lib/db");
  await migrate(db);
  logger.info("Database migrations complete");

  if (process.env.DISABLE_BACKGROUND === "true") {
    logger.info(
      "DISABLE_BACKGROUND=true: skipping queue, federation tasks, and poller",
    );
    return;
  }

  federation.startQueue();
  logger.info("Fedify message queue worker started");

  const {
    subscribeToRelays,
    followAccounts,
    sendProfileUpdates,
    sendDeletedBotActivities,
    repairFollowerInboxes,
  } = await import("@/lib/federation");

  const fedCtx = federation.createContext(new URL(`https://${domain}`));
  const botUsernames = Object.keys(config.bots);

  repairFollowerInboxes(fedCtx, db, botUsernames).catch((err) => {
    logger.error("Follower inbox repair failed: {error}", { error: err });
  });

  subscribeToRelays(fedCtx, db, config).catch((err) => {
    logger.error("Relay subscription failed: {error}", { error: err });
  });

  followAccounts(fedCtx, db, config).catch((err) => {
    logger.error("Follow accounts failed: {error}", { error: err });
  });

  sendProfileUpdates(fedCtx, db, config).catch((err) => {
    logger.error("Profile update failed: {error}", { error: err });
  });

  sendDeletedBotActivities(fedCtx, db, config).catch((err) => {
    logger.error("Deleted bot cleanup failed: {error}", { error: err });
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
