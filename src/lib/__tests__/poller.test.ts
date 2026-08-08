import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../rss", () => ({
  fetchFeedWithHttpResult: vi.fn(),
}));

vi.mock("../publisher", () => ({
  publishNewEntries: vi.fn(),
}));

vi.mock("../db", () => ({
  upsertFeedPollStatus: vi.fn().mockResolvedValue(undefined),
}));

import { fetchFeedWithHttpResult } from "../rss";
import { publishNewEntries } from "../publisher";
import { startPoller } from "../poller";
import type { FeedsConfig } from "../config";

const mockFetchFeed = vi.mocked(fetchFeedWithHttpResult);
const mockPublishNewEntries = vi.mocked(publishNewEntries);

function makeConfig(botCount: number): FeedsConfig {
  const bots: FeedsConfig["bots"] = {};
  for (let i = 0; i < botCount; i++) {
    bots[`bot${i}`] = {
      feed_url: `https://example.com/feed${i}.xml`,
      display_name: `Bot ${i}`,
      summary: "A test bot",
    };
  }
  return { bots, follows: [], relays: [] };
}

describe("startPoller concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPublishNewEntries.mockResolvedValue({ published: 0, skipped: 0 });
  });

  it("polls all configured bots", async () => {
    const botCount = 6;
    mockFetchFeed.mockResolvedValue({ entries: [], httpStatus: 200, errorMessage: null });

    const poller = startPoller({
      config: makeConfig(botCount),
      db: {} as never,
      domain: "robot.villas",
      intervalMs: 10_000_000,
      concurrency: 2,
      getContext: () => ({}) as never,
    });

    await vi.waitFor(() => {
      expect(mockFetchFeed).toHaveBeenCalledTimes(botCount);
    });

    poller.stop();
  });

  it("never has more than `concurrency` feed fetches in flight at once", async () => {
    const botCount = 8;
    const concurrency = 2;
    let active = 0;
    let maxActive = 0;

    mockFetchFeed.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active--;
      return { entries: [], httpStatus: 200, errorMessage: null };
    });

    const poller = startPoller({
      config: makeConfig(botCount),
      db: {} as never,
      domain: "robot.villas",
      intervalMs: 10_000_000,
      concurrency,
      getContext: () => ({}) as never,
    });

    await vi.waitFor(
      () => {
        expect(mockFetchFeed).toHaveBeenCalledTimes(botCount);
      },
      { timeout: 5000 },
    );

    poller.stop();
    expect(maxActive).toBeLessThanOrEqual(concurrency);
  });

  it("continues polling remaining bots when one bot's fetch throws", async () => {
    const botCount = 4;
    mockFetchFeed.mockImplementation(async (feedUrl: string) => {
      if (feedUrl.includes("feed1")) {
        throw new Error("network error");
      }
      return { entries: [], httpStatus: 200, errorMessage: null };
    });

    const poller = startPoller({
      config: makeConfig(botCount),
      db: {} as never,
      domain: "robot.villas",
      intervalMs: 10_000_000,
      concurrency: 2,
      getContext: () => ({}) as never,
    });

    await vi.waitFor(() => {
      expect(mockFetchFeed).toHaveBeenCalledTimes(botCount);
    });

    poller.stop();
  });
});
