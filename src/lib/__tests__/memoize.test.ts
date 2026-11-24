import { describe, expect, it } from "vitest";
import { memoizeAsync, memoizeAsyncFor } from "../memoize";

describe("memoizeAsyncFor", () => {
  const clock = () => {
    let now = 1_000;
    const advance = (ms: number) => {
      now += ms;
    };
    return { perf: { now: () => now }, advance };
  };

  it("shares one load between concurrent callers and reuses it until the TTL ends", async () => {
    const { perf, advance } = clock();
    const calls: string[] = [];
    const load = memoizeAsyncFor(async (key: string) => {
      calls.push(key);
      return { key };
    }, { ttlMs: 60_000, max: 10, perf });

    const [a, b] = await Promise.all([load("alice"), load("alice")]);
    advance(59_000);
    const c = await load("alice");
    advance(2_000);
    const d = await load("alice");

    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(d).toEqual(a);
    expect(calls).toEqual(["alice", "alice"]);
  });

  it("does not keep null results", async () => {
    let attempts = 0;
    const load = memoizeAsyncFor(async () => {
      attempts++;
      return attempts === 1 ? null : "found";
    }, { ttlMs: 60_000, max: 10 });

    expect(await load("bob")).toBeNull();
    expect(await load("bob")).toBe("found");
  });

  it("retries a key whose load failed", async () => {
    let attempts = 0;
    const load = memoizeAsyncFor(async (key: string) => {
      attempts++;
      if (attempts === 1) {
        throw new Error("database unavailable");
      }
      return key;
    }, { ttlMs: 60_000, max: 10 });

    await expect(load("alice")).rejects.toThrow("database unavailable");
    expect(await load("alice")).toBe("alice");
  });
});

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
