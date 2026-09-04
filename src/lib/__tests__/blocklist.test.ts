import { describe, it, expect } from "vitest";
import {
  buildBlocklist,
  isBlockedHost,
  normalizeHost,
  partitionBlockedRecipients,
} from "../blocklist";

describe("normalizeHost", () => {
  it("lowercases", () => {
    expect(normalizeHost("Example.COM")).toBe("example.com");
  });

  it("accepts a pasted url instead of a bare host", () => {
    // blocked_instances is hand-edited; pasting the inbox URL is the obvious slip.
    expect(normalizeHost("https://example.com/inbox")).toBe("example.com");
    expect(normalizeHost("example.com/inbox")).toBe("example.com");
  });

  it("strips the DNS root dot", () => {
    expect(normalizeHost("example.com.")).toBe("example.com");
  });

  it("returns empty for blank input", () => {
    expect(normalizeHost("   ")).toBe("");
  });
});

describe("isBlockedHost", () => {
  const blocked = buildBlocklist(["evil.com", "8ball.space"]);

  it("matches the exact host", () => {
    expect(isBlockedHost("evil.com", blocked)).toBe(true);
  });

  it("matches subdomains of a blocked domain", () => {
    // Otherwise a blocked instance walks straight back in as a subdomain.
    expect(isBlockedHost("mastodon.evil.com", blocked)).toBe(true);
  });

  it("does not match a host that merely ends with the same letters", () => {
    expect(isBlockedHost("notevil.com", blocked)).toBe(false);
  });

  it("does not match a parent of a blocked host", () => {
    expect(isBlockedHost("space", blocked)).toBe(false);
  });

  it("is case and trailing-dot insensitive", () => {
    expect(isBlockedHost("EVIL.com.", blocked)).toBe(true);
  });

  it("returns false for an empty blocklist", () => {
    expect(isBlockedHost("evil.com", new Set())).toBe(false);
  });
});

describe("buildBlocklist", () => {
  it("drops blanks and normalizes entries", () => {
    const set = buildBlocklist([" Evil.COM ", "", "   ", "https://8ball.space/inbox"]);
    expect([...set].sort()).toEqual(["8ball.space", "evil.com"]);
  });
});

describe("partitionBlockedRecipients", () => {
  const rec = (host: string) => ({ inboxId: new URL(`https://${host}/inbox`) });

  it("splits recipients by blocked host", () => {
    const blocked = buildBlocklist(["evil.com"]);
    const { allowed, blockedHosts } = partitionBlockedRecipients(
      [rec("good.example"), rec("evil.com"), rec("shard.evil.com")],
      blocked,
    );
    expect(allowed.map((r) => r.inboxId.hostname)).toEqual(["good.example"]);
    expect(blockedHosts).toEqual(["evil.com", "shard.evil.com"]);
  });

  it("passes everything through when nothing is blocked", () => {
    const recipients = [rec("a.example"), rec("b.example")];
    const { allowed, blockedHosts } = partitionBlockedRecipients(recipients, new Set());
    expect(allowed).toHaveLength(2);
    expect(blockedHosts).toEqual([]);
  });

  it("treats a recipient with no inbox as not blocked", () => {
    // Malformed rows are somebody else's problem; swallowing them here would
    // hide them from whatever should be reporting them.
    const { allowed, blockedHosts } = partitionBlockedRecipients(
      [{ inboxId: null }],
      buildBlocklist(["evil.com"]),
    );
    expect(allowed).toHaveLength(1);
    expect(blockedHosts).toEqual([]);
  });
});
