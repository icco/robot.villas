import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "../concurrency";

describe("mapWithConcurrency", () => {
  it("returns results in input order regardless of completion order", async () => {
    const delays = [30, 10, 20, 0];
    const results = await mapWithConcurrency(delays, 4, async (delay, i) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return i;
    });
    expect(results).toEqual([0, 1, 2, 3]);
  });

  it("never runs more than `limit` calls concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return i;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("processes every item exactly once", async () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const seen: number[] = [];
    await mapWithConcurrency(items, 4, async (i) => {
      seen.push(i);
      return i * 2;
    });
    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  it("handles an empty item list without invoking fn", async () => {
    let calls = 0;
    const results = await mapWithConcurrency([], 5, async () => {
      calls++;
      return null;
    });
    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  it("clamps effective concurrency to the number of items", async () => {
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrency([1, 2], 10, async (i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return i;
    });
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("propagates a thrown error from fn", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (i) => {
        if (i === 2) {
          throw new Error("boom");
        }
        return i;
      }),
    ).rejects.toThrow("boom");
  });
});
