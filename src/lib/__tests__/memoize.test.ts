import { describe, expect, it } from "vitest";
import { memoizeAsync } from "../memoize";

describe("memoizeAsync", () => {
  it("loads each key once, even for concurrent callers", async () => {
    const calls: string[] = [];
    const load = memoizeAsync(async (key: string) => {
      calls.push(key);
      return { key };
    });

    const [a, b] = await Promise.all([load("alice"), load("alice")]);
    const c = await load("alice");

    expect(calls).toEqual(["alice"]);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("loads different keys separately", async () => {
    const calls: string[] = [];
    const load = memoizeAsync(async (key: string) => {
      calls.push(key);
      return key.toUpperCase();
    });

    expect(await load("alice")).toBe("ALICE");
    expect(await load("bob")).toBe("BOB");
    expect(calls).toEqual(["alice", "bob"]);
  });

  it("retries a key whose load failed", async () => {
    let attempts = 0;
    const load = memoizeAsync(async (key: string) => {
      attempts++;
      if (attempts === 1) {
        throw new Error("database unavailable");
      }
      return key;
    });

    await expect(load("alice")).rejects.toThrow("database unavailable");
    expect(await load("alice")).toBe("alice");
    expect(attempts).toBe(2);
  });
});
