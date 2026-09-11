import { describe, it, expect } from "vitest";
import { Follow, PUBLIC_COLLECTION } from "@fedify/vocab";
import {
  RELAY_REJECT_RETRY_MS,
  isRelayTerminal,
  findLostAccepts,
  summarizeRelaySubscription,
  RelayFollow,
  AS_PUBLIC,
  selectRemovedRelays,
  normalizeIdUrl,
} from "../subscriptions";

const FOLLOW_ARGS = {
  id: new URL("https://robot.villas/users/nyt_homepage/follows/x"),
  actor: new URL("https://robot.villas/users/nyt_homepage"),
  object: PUBLIC_COLLECTION,
};

describe("RelayFollow", () => {
  it("serializes object as the full Public IRI", async () => {
    const json = (await new RelayFollow(FOLLOW_ARGS).toJsonLd()) as Record<string, unknown>;
    expect(json.object).toBe(AS_PUBLIC);
    expect(json.type).toBe("Follow");
  });

  it("documents the upstream behaviour it works around", async () => {
    // Plain Follow compacts to the CURIE, which YUKIMOCHI Activity-Relay
    // rejects because it string-compares against the full IRI.
    const json = (await new Follow(FOLLOW_ARGS).toJsonLd()) as Record<string, unknown>;
    expect(json.object).toBe("as:Public");
  });

  it("survives clone(), which Fedify uses internally", async () => {
    const cloned = new RelayFollow(FOLLOW_ARGS).clone({});
    expect(cloned).toBeInstanceOf(RelayFollow);
    const json = (await cloned.toJsonLd()) as Record<string, unknown>;
    expect(json.object).toBe(AS_PUBLIC);
  });

  it("leaves a non-Public object untouched", async () => {
    const json = (await new RelayFollow({
      ...FOLLOW_ARGS,
      object: new URL("https://tags.pub/user/_followback"),
    }).toJsonLd()) as Record<string, unknown>;
    expect(json.object).toBe("https://tags.pub/user/_followback");
  });
});

const NOW = new Date("2026-08-16T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("isRelayTerminal", () => {
  it("treats accepted as permanently terminal", () => {
    expect(isRelayTerminal("accepted", daysAgo(9999), NOW)).toBe(true);
    expect(isRelayTerminal("accepted", null, NOW)).toBe(true);
  });

  it("never treats pending as terminal", () => {
    expect(isRelayTerminal("pending", daysAgo(1), NOW)).toBe(false);
    expect(isRelayTerminal("pending", null, NOW)).toBe(false);
  });

  it("honors a recent rejection", () => {
    expect(isRelayTerminal("rejected", daysAgo(1), NOW)).toBe(true);
    expect(isRelayTerminal("rejected", daysAgo(29), NOW)).toBe(true);
  });

  it("expires a rejection once the cooldown passes", () => {
    expect(isRelayTerminal("rejected", daysAgo(31), NOW)).toBe(false);
    expect(isRelayTerminal("rejected", daysAgo(120), NOW)).toBe(false);
  });

  it("re-asks when the rejection has no recorded time", () => {
    // Rows rejected before status_changed_at existed have an unknown age. Ask
    // once; the reply stamps the column and starts the cooldown properly.
    expect(isRelayTerminal("rejected", null, NOW)).toBe(false);
  });

  it("uses the configured cooldown", () => {
    expect(isRelayTerminal("rejected", daysAgo(2), NOW, 24 * 60 * 60 * 1000)).toBe(false);
    expect(RELAY_REJECT_RETRY_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("summarizeRelaySubscription", () => {
  const row = (botUsername: string, status: "pending" | "accepted" | "rejected", d?: Date) => ({
    botUsername,
    status,
    statusChangedAt: d ?? null,
  });

  it("reports none when the relay has no rows", () => {
    expect(summarizeRelaySubscription([])).toMatchObject({ status: "none", botUsername: null });
  });

  it("a single accepted row is a complete subscription", () => {
    // Relays key subscriptions by domain, so one accepted row covers every bot.
    const s = summarizeRelaySubscription([row("nyt_homepage", "accepted", NOW)]);
    expect(s).toMatchObject({ status: "accepted", botUsername: "nyt_homepage" });
    expect(s.statusChangedAt).toBe(NOW);
  });

  it("prefers accepted over pending and rejected", () => {
    const s = summarizeRelaySubscription([
      row("a", "rejected"),
      row("b", "accepted", NOW),
      row("c", "pending"),
    ]);
    expect(s).toMatchObject({ status: "accepted", botUsername: "b" });
  });

  it("prefers pending over rejected", () => {
    expect(summarizeRelaySubscription([row("a", "rejected"), row("b", "pending")])).toMatchObject({
      status: "pending",
      botUsername: "b",
    });
  });

  it("collapses duplicate rows to one state", () => {
    // Legacy rows from the all-bots era are bookkeeping, not extra coverage.
    const rows = Array.from({ length: 57 }, (_, i) => row(`bot${i}`, "accepted"));
    expect(summarizeRelaySubscription(rows)).toMatchObject({ status: "accepted" });
  });

  it("picks the most recent row, not the first", () => {
    const older = new Date("2026-01-01T00:00:00Z");
    const rows = [row("stale", "accepted", older), row("fresh", "accepted", NOW)];
    expect(summarizeRelaySubscription(rows)).toMatchObject({ botUsername: "fresh" });
    // Same answer whatever order the DB hands them back in.
    expect(summarizeRelaySubscription([...rows].reverse())).toMatchObject({ botUsername: "fresh" });
  });

  it("prefers a row with a timestamp over one without", () => {
    const rows = [row("undated", "accepted"), row("dated", "accepted", NOW)];
    expect(summarizeRelaySubscription(rows)).toMatchObject({
      botUsername: "dated",
      statusChangedAt: NOW,
    });
    expect(summarizeRelaySubscription([...rows].reverse())).toMatchObject({ botUsername: "dated" });
  });

  it("reports rejected when every row is rejected", () => {
    expect(summarizeRelaySubscription([row("a", "rejected", NOW)])).toMatchObject({
      status: "rejected",
      botUsername: "a",
    });
  });
});

describe("findLostAccepts", () => {
  const pending = [
    { botUsername: "import_ai", actorId: "https://robot.villas/users/import_ai" },
    { botUsername: "hell_gate", actorId: "https://robot.villas/users/hell_gate" },
    { botUsername: "danluu", actorId: "https://robot.villas/users/danluu" },
  ];

  it("returns bots the target already lists as followers", () => {
    const followers = new Set([
      "https://robot.villas/users/import_ai",
      "https://robot.villas/users/hell_gate",
      "https://example.com/users/someone",
    ]);
    expect(findLostAccepts(pending, followers).sort()).toEqual(["hell_gate", "import_ai"]);
  });

  it("returns nothing when the target lists none of them", () => {
    expect(findLostAccepts(pending, new Set(["https://example.com/users/x"]))).toEqual([]);
  });

  it("returns nothing for an empty followers collection", () => {
    // An actor that hides its followers must not be read as "no follow exists";
    // the caller falls back to re-sending the Follow.
    expect(findLostAccepts(pending, new Set())).toEqual([]);
  });

  it("ignores a trailing slash difference", () => {
    const followers = new Set(["https://robot.villas/users/danluu/"]);
    expect(findLostAccepts(pending, followers)).toEqual(["danluu"]);
  });

  it("skips rows with no resolved actor id", () => {
    const rows = [{ botUsername: "ghost", actorId: null }];
    expect(findLostAccepts(rows, new Set(["https://robot.villas/users/ghost"]))).toEqual([]);
  });
});

describe("selectRemovedRelays", () => {
  const rows = [
    { url: "https://relay.toot.io/actor", botUsername: "nyt_homepage" },
    { url: "https://relay.intahnet.co.uk/actor", botUsername: "nyt_homepage" },
  ];

  it("returns rows whose url is no longer configured", () => {
    const removed = selectRemovedRelays(rows, ["https://relay.toot.io/actor"]);
    expect(removed.map((r) => r.url)).toEqual(["https://relay.intahnet.co.uk/actor"]);
  });

  it("returns nothing when every row is still configured", () => {
    expect(selectRemovedRelays(rows, rows.map((r) => r.url))).toEqual([]);
  });

  it("returns every row when the config lists no relays", () => {
    // Emptying `relays:` has to unsubscribe, not no-op, or the last relay is
    // unreachable through config.
    expect(selectRemovedRelays(rows, [])).toHaveLength(2);
  });

  it("ignores a trailing slash difference", () => {
    // Otherwise reformatting feeds.yml silently drops a relay we still want.
    const removed = selectRemovedRelays(rows, [
      "https://relay.toot.io/actor/",
      "https://relay.intahnet.co.uk/actor",
    ]);
    expect(removed).toEqual([]);
  });
});

describe("normalizeIdUrl", () => {
  it("treats the two trailing-slash forms as one url", () => {
    // subscribeToRelays and unsubscribeFromRemovedRelays both key off this. If
    // only one of them normalized, a slash-only feeds.yml edit would look like
    // a removal to one and a brand new relay to the other -- and upsertRelay
    // conflicts on (botUsername, url) exactly, so it would write a second row.
    expect(normalizeIdUrl("https://relay.toot.io/actor/")).toBe(normalizeIdUrl("https://relay.toot.io/actor"));
  });

  it("leaves a url without a trailing slash alone", () => {
    expect(normalizeIdUrl("https://relay.toot.io/actor")).toBe("https://relay.toot.io/actor");
  });
});
