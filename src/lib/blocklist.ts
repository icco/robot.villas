/** Instance blocklist: what we refuse to federate with, in both directions. */

/**
 * Lowercased hostname for comparison. Accepts a bare host or a full URL, since
 * `blocked_instances` is hand-edited and pasting `https://example.com/inbox`
 * is the obvious mistake. A trailing dot (the DNS root) is stripped so
 * `example.com.` and `example.com` are one host.
 */
export function normalizeHost(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") {
    return "";
  }
  let host = trimmed;
  if (host.includes("/") || host.includes(":")) {
    try {
      host = new URL(host.includes("//") ? host : `https://${host}`).hostname;
    } catch {
      // Not a URL after all; fall through and treat it as a bare host.
      host = trimmed;
    }
  }
  return host.toLowerCase().replace(/\.$/, "");
}

/** Builds the comparison set. Empty and unparseable entries drop out. */
export function buildBlocklist(hosts: Iterable<string>): ReadonlySet<string> {
  const set = new Set<string>();
  for (const raw of hosts) {
    const host = normalizeHost(raw);
    if (host !== "") {
      set.add(host);
    }
  }
  return set;
}

/**
 * Whether `host` is blocked. Blocking a domain blocks its subdomains too —
 * that is what every other fediverse server means by a domain block, and
 * without it a blocked instance walks back in as `mastodon.example.com`.
 * Matching is suffix-on-a-label-boundary, so `notevil.com` is not caught by
 * a block on `evil.com`.
 */
export function isBlockedHost(host: string, blocked: ReadonlySet<string>): boolean {
  if (blocked.size === 0) {
    return false;
  }
  const needle = normalizeHost(host);
  if (needle === "") {
    return false;
  }
  if (blocked.has(needle)) {
    return true;
  }
  for (const domain of blocked) {
    if (needle.endsWith(`.${domain}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Splits delivery recipients into those we will send to and those we will not.
 * Callers log the blocked count rather than dropping it silently — a blocklist
 * that quietly eats deliveries is indistinguishable from a delivery bug.
 *
 * An `inboxId` we cannot parse is treated as not blocked: the blocklist is not
 * the right place to reject malformed rows, and swallowing them here would
 * hide them from whatever does.
 */
export function partitionBlockedRecipients<T extends { inboxId?: URL | null }>(
  recipients: ReadonlyArray<T>,
  blocked: ReadonlySet<string>,
): { allowed: T[]; blockedHosts: string[] } {
  if (blocked.size === 0) {
    return { allowed: [...recipients], blockedHosts: [] };
  }
  const allowed: T[] = [];
  const blockedHosts: string[] = [];
  for (const r of recipients) {
    const host = r.inboxId ? normalizeHost(r.inboxId.hostname) : "";
    if (host !== "" && isBlockedHost(host, blocked)) {
      blockedHosts.push(host);
    } else {
      allowed.push(r);
    }
  }
  return { allowed, blockedHosts };
}
