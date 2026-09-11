/** Relay and follow subscription helpers: retry policy, reconciliation, wire format. */

import { Follow } from "@fedify/vocab";

export const AS_PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

/**
 * A Follow that serializes `object` as the full Public IRI instead of the
 * `as:Public` CURIE that JSON-LD compaction produces.
 *
 * YUKIMOCHI Activity-Relay — which relay.toot.io and relay.intahnet.co.uk both
 * run — validates subscriptions with a literal string comparison against the
 * full IRI, so the compacted form falls through to its "only
 * https://www.w3.org/ns/activitystreams#Public is allowed to follow" Reject.
 * Fedify applies the same rewrite to to/cc/bto/bcc/audience as of 2.2.0 but not
 * to `object`. Rewriting inside toJsonLd keeps the signed bytes and the wire
 * bytes identical.
 */
export class RelayFollow extends Follow {
  override async toJsonLd(options?: Parameters<Follow["toJsonLd"]>[0]): Promise<unknown> {
    const json = await super.toJsonLd(options);
    if (json && typeof json === "object") {
      const doc = json as Record<string, unknown>;
      if (doc.object === "as:Public" || doc.object === "Public") {
        doc.object = AS_PUBLIC;
      }
    }
    return json;
  }
}

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

export interface RelaySubscriptionState {
  status: RelayStatus | "none";
  /** The bot whose row holds the subscription, for display. */
  botUsername: string | null;
  statusChangedAt: Date | null;
}

/**
 * Collapses a relay's rows into one instance-level state. Relays key
 * subscriptions by domain, so one accepted row subscribes every bot — per-bot
 * counts are our bookkeeping, not coverage.
 */
export function summarizeRelaySubscription(
  rows: ReadonlyArray<{ botUsername: string; status: RelayStatus; statusChangedAt: Date | null }>,
): RelaySubscriptionState {
  // Most recent wins, dated over undated — row order from the DB is arbitrary.
  const changedAt = (r: { statusChangedAt: Date | null }) => r.statusChangedAt?.getTime() ?? -Infinity;
  for (const status of ["accepted", "pending", "rejected"] as const) {
    const matching = rows.filter((r) => r.status === status);
    if (matching.length === 0) {
      continue;
    }
    const winner = matching.reduce((best, r) => (changedAt(r) > changedAt(best) ? r : best));
    return { status, botUsername: winner.botUsername, statusChangedAt: winner.statusChangedAt };
  }
  return { status: "none", botUsername: null, statusChangedAt: null };
}

/**
 * Instances vary on trailing slashes, so every comparison between a URL we
 * store and one we were handed goes through this. Relay bookkeeping keys on
 * `(botUsername, url)` exactly, so treating the two forms as different URLs
 * writes a second row for the same relay.
 */
export function normalizeIdUrl(id: string): string {
  return id.endsWith("/") ? id.slice(0, -1) : id;
}

/**
 * Relay rows whose URL is no longer in feeds.yml. Trailing slashes are
 * normalized on both sides: a config edit that only adds or drops one must not
 * read as a removal and unsubscribe a relay we still want.
 */
export function selectRemovedRelays<T extends { url: string }>(
  rows: ReadonlyArray<T>,
  configuredUrls: Iterable<string>,
): T[] {
  const configured = new Set([...configuredUrls].map(normalizeIdUrl));
  return rows.filter((row) => !configured.has(normalizeIdUrl(row.url)));
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
  const normalized = new Set([...followerIds].map(normalizeIdUrl));
  return pending
    .filter((row) => row.actorId !== null && normalized.has(normalizeIdUrl(row.actorId)))
    .map((row) => row.botUsername);
}
