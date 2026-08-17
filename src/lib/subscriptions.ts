/** Escape hatches from terminal subscription state that would otherwise stick forever. */

/** How long a relay Reject is honored before we re-attempt. */
export const RELAY_REJECT_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

export type RelayStatus = "pending" | "accepted" | "rejected";

/**
 * Whether a relay row should still block a new Follow. `accepted` is permanent;
 * `rejected` expires so a relay we were denied by under a since-fixed
 * subscription format gets re-asked. A null time predates the column — ask once,
 * and the reply stamps it.
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

/** Instances vary on trailing slashes. */
function normalizeActorId(id: string): string {
  return id.endsWith("/") ? id.slice(0, -1) : id;
}

/**
 * Pending follows the target already lists as followers — an Accept that was
 * delivered but never recorded. The target won't re-Accept a duplicate Follow,
 * so retrying can't clear these. Empty `followerIds` (hidden followers) yields
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
