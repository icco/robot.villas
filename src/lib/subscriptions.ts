/**
 * Decisions about when a stored subscription row may be re-attempted.
 *
 * Both relay subscriptions and account follows record a terminal status that
 * stops us re-sending a Follow forever. That is right for `accepted` and wrong
 * for everything else: a Reject from four months ago, or an Accept that was
 * delivered but never matched a row, leaves the subscription frozen with no way
 * back. These helpers are the two escape hatches.
 */

/** How long a relay Reject is honored before we re-attempt the subscription. */
export const RELAY_REJECT_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

export type RelayStatus = "pending" | "accepted" | "rejected";

/**
 * Whether a relay row should still block a new Follow.
 *
 * `accepted` is permanent. `rejected` expires, so a relay that denied us under
 * a subscription format we have since fixed gets asked again instead of staying
 * frozen. A rejection with no recorded time predates `status_changed_at`; ask
 * once, and the reply stamps the column so the cooldown applies from then on.
 */
export function isRelayTerminal(
  status: RelayStatus,
  statusChangedAt: Date | null,
  now: Date,
  retryAfterMs: number = RELAY_REJECT_RETRY_MS,
): boolean {
  if (status === "accepted") {
    return true;
  }
  if (status !== "rejected") {
    return false;
  }
  if (statusChangedAt === null) {
    return false;
  }
  return now.getTime() - statusChangedAt.getTime() < retryAfterMs;
}

/** Compares actor URIs ignoring a trailing slash, which instances vary on. */
function normalizeActorId(id: string): string {
  return id.endsWith("/") ? id.slice(0, -1) : id;
}

/**
 * Given our still-pending follows of one target and that target's followers
 * collection, returns the bots the target already considers followers.
 *
 * These are follows whose `Accept` was delivered but never recorded — the
 * target will not re-Accept a duplicate Follow, so retrying can never clear
 * them. An empty `followerIds` (an actor that hides its followers) yields
 * nothing, so the caller falls back to re-sending.
 */
export function findLostAccepts(
  pending: ReadonlyArray<{ botUsername: string; actorId: string | null }>,
  followerIds: ReadonlySet<string>,
): string[] {
  if (followerIds.size === 0) {
    return [];
  }
  const normalized = new Set([...followerIds].map(normalizeActorId));
  return pending
    .filter((row) => row.actorId !== null && normalized.has(normalizeActorId(row.actorId)))
    .map((row) => row.botUsername);
}
