import { describe, it, expect } from "vitest";
import {
  RELAY_REJECT_RETRY_MS,
  isRelayTerminal,
  findLostAccepts,
} from "../subscriptions";

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
