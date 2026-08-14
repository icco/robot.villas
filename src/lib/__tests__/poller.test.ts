import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../rss", () => ({
  fetchFeedWithHttpResult: vi.fn(),
}));

vi.mock("../publisher", () => ({
  publishNewEntries: vi.fn(),
}));

vi.mock("../db", () => ({
  upsertFeedPollStatus: vi.fn().mockResolvedValue(undefined),
  getFeedPollStatusMap: vi.fn().mockResolvedValue(new Map()),
}));

import { fetchFeedWithHttpResult, type FeedFetchResult } from "../rss";
import { publishNewEntries } from "../publisher";
import { startPoller } from "../poller";
import { getFeedPollStatusMap, upsertFeedPollStatus, type FeedPollStatusRow } from "../db";
import type { FeedsConfig } from "../config";

const mockFetchFeed = vi.mocked(fetchFeedWithHttpResult);
const mockPublishNewEntries = vi.mocked(publishNewEntries);
const mockGetStatusMap = vi.mocked(getFeedPollStatusMap);
const mockUpsertStatus = vi.mocked(upsertFeedPollStatus);

/** A successful, unconditional fetch: parsed fine, nothing to back off from. */
function okFetch(overrides: Partial<FeedFetchResult> = {}): FeedFetchResult {
  return {
    entries: [],
    httpStatus: 200,
    errorMessage: null,
    notModified: false,
    validators: { etag: null, lastModified: null },
    retryAfterMs: null,
    ...overrides,
  };
}

function statusRow(overrides: Partial<FeedPollStatusRow> = {}): FeedPollStatusRow {
  return {
    botUsername: "bot0",
    lastCheckedAt: new Date("2026-08-14T20:00:00Z"),
    lastHttpStatus: 200,
    lastError: null,
    etag: null,
    lastModified: null,
    nextPollAt: null,
    ...overrides,
  };
}

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
    mockGetStatusMap.mockResolvedValue(new Map());
  });

  it("polls all configured bots", async () => {
    const botCount = 6;
    mockFetchFeed.mockResolvedValue(okFetch());

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
      return okFetch();
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
      return okFetch();
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

  it("falls back to the default concurrency instead of polling zero bots when given NaN", async () => {
    const botCount = 3;
    mockFetchFeed.mockResolvedValue(okFetch());

    const poller = startPoller({
      config: makeConfig(botCount),
      db: {} as never,
      domain: "robot.villas",
      intervalMs: 10_000_000,
      concurrency: Number.parseInt("not-a-number", 10),
      getContext: () => ({}) as never,
    });

    await vi.waitFor(() => {
      expect(mockFetchFeed).toHaveBeenCalledTimes(botCount);
    });

    poller.stop();
  });
});

describe("startPoller conditional GET and rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPublishNewEntries.mockResolvedValue({ published: 0, skipped: 0 });
    mockGetStatusMap.mockResolvedValue(new Map());
  });

  function startOneBot() {
    return startPoller({
      config: makeConfig(1),
      db: {} as never,
      domain: "robot.villas",
      intervalMs: 10_000_000,
      concurrency: 1,
      getContext: () => ({}) as never,
    });
  }

  it("sends the stored validators with the next request", async () => {
    mockGetStatusMap.mockResolvedValue(
      new Map([["bot0", statusRow({ etag: '"abc"', lastModified: "yesterday" })]]),
    );
    mockFetchFeed.mockResolvedValue(okFetch({ httpStatus: 304, notModified: true }));

    const poller = startOneBot();
    await vi.waitFor(() => {
      expect(mockFetchFeed).toHaveBeenCalledTimes(1);
    });
    poller.stop();

    expect(mockFetchFeed).toHaveBeenCalledWith("https://example.com/feed0.xml", {
      etag: '"abc"',
      lastModified: "yesterday",
    });
  });

  it("does not publish anything when the feed is unmodified", async () => {
    mockFetchFeed.mockResolvedValue(okFetch({ httpStatus: 304, notModified: true }));

    const poller = startOneBot();
    await vi.waitFor(() => {
      expect(mockUpsertStatus).toHaveBeenCalledTimes(1);
    });
    poller.stop();

    expect(mockPublishNewEntries).not.toHaveBeenCalled();
    expect(mockUpsertStatus.mock.calls[0][1]).toMatchObject({ lastError: null, lastHttpStatus: 304 });
  });

  it("keeps the stored validators when a fetch fails", async () => {
    mockGetStatusMap.mockResolvedValue(
      new Map([["bot0", statusRow({ etag: '"abc"', lastModified: "yesterday" })]]),
    );
    mockFetchFeed.mockResolvedValue(
      okFetch({ httpStatus: 500, errorMessage: "HTTP 500", validators: null }),
    );

    const poller = startOneBot();
    await vi.waitFor(() => {
      expect(mockUpsertStatus).toHaveBeenCalledTimes(1);
    });
    poller.stop();

    expect(mockUpsertStatus.mock.calls[0][1]).toMatchObject({
      etag: '"abc"',
      lastModified: "yesterday",
      nextPollAt: null,
    });
  });

  it("records a backoff deadline when the server rate limits us", async () => {
    mockFetchFeed.mockResolvedValue(
      okFetch({
        httpStatus: 429,
        errorMessage: "HTTP 429",
        validators: null,
        retryAfterMs: 3_600_000,
      }),
    );

    const before = Date.now();
    const poller = startOneBot();
    await vi.waitFor(() => {
      expect(mockUpsertStatus).toHaveBeenCalledTimes(1);
    });
    poller.stop();

    const nextPollAt = mockUpsertStatus.mock.calls[0][1].nextPollAt;
    expect(nextPollAt).toBeInstanceOf(Date);
    expect(nextPollAt!.getTime()).toBeGreaterThanOrEqual(before + 3_600_000);
  });

  it("skips a feed that is still backing off, without overwriting its status", async () => {
    mockGetStatusMap.mockResolvedValue(
      new Map([
        [
          "bot0",
          statusRow({
            lastHttpStatus: 429,
            lastError: "HTTP 429",
            nextPollAt: new Date(Date.now() + 60_000),
          }),
        ],
      ]),
    );
    mockFetchFeed.mockResolvedValue(okFetch());

    const poller = startOneBot();
    await vi.waitFor(() => {
      expect(mockGetStatusMap).toHaveBeenCalledTimes(1);
    });
    // Give the poll cycle a chance to (wrongly) fetch before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 50));
    poller.stop();

    expect(mockFetchFeed).not.toHaveBeenCalled();
    expect(mockUpsertStatus).not.toHaveBeenCalled();
  });

  it("polls again once the backoff deadline has passed", async () => {
    mockGetStatusMap.mockResolvedValue(
      new Map([["bot0", statusRow({ nextPollAt: new Date(Date.now() - 1_000) })]]),
    );
    mockFetchFeed.mockResolvedValue(okFetch());

    const poller = startOneBot();
    await vi.waitFor(() => {
      expect(mockFetchFeed).toHaveBeenCalledTimes(1);
    });
    poller.stop();
  });
});
