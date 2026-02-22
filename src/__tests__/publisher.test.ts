import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.js", () => ({
  hasEntry: vi.fn(),
  insertEntry: vi.fn(),
  getFollowers: vi.fn(),
}));

import { hasEntry, insertEntry, getFollowers } from "../db.js";
import { publishNewEntries } from "../publisher.js";
import type { FeedEntry } from "../rss.js";

const mockHasEntry = vi.mocked(hasEntry);
const mockInsertEntry = vi.mocked(insertEntry);
const mockGetFollowers = vi.mocked(getFollowers);

const mockCtx = {
  sendActivity: vi.fn().mockResolvedValue(undefined),
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const entries: FeedEntry[] = [
  { guid: "g1", title: "First Post", link: "https://example.com/1", publishedAt: new Date("2024-01-01") },
  { guid: "g2", title: "Second Post", link: "https://example.com/2", publishedAt: null },
  { guid: "g3", title: "Third Post", link: "", publishedAt: null },
];

describe("publishNewEntries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasEntry.mockResolvedValue(false);
    mockInsertEntry.mockResolvedValue(undefined);
    mockGetFollowers.mockResolvedValue(["https://remote.example/user/1"]);
  });

  it("publishes new entries and skips existing ones", async () => {
    mockHasEntry.mockResolvedValueOnce(true); // g1 already exists
    mockHasEntry.mockResolvedValueOnce(false); // g2 is new
    mockHasEntry.mockResolvedValueOnce(false); // g3 is new

    const result = await publishNewEntries(
      mockCtx,
      {} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      "testbot",
      "robot.villas",
      entries,
    );

    expect(result.skipped).toBe(1);
    expect(result.published).toBe(2);
    expect(mockInsertEntry).toHaveBeenCalledTimes(2);
    expect(mockCtx.sendActivity).toHaveBeenCalledTimes(2);
  });

  it("records entries but does not send when there are no followers", async () => {
    mockGetFollowers.mockResolvedValue([]);

    const result = await publishNewEntries(
      mockCtx,
      {} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      "testbot",
      "robot.villas",
      entries,
    );

    expect(result.published).toBe(0);
    expect(mockInsertEntry).toHaveBeenCalledTimes(3);
    expect(mockCtx.sendActivity).not.toHaveBeenCalled();
  });

  it("skips all entries when all already exist", async () => {
    mockHasEntry.mockResolvedValue(true);

    const result = await publishNewEntries(
      mockCtx,
      {} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      "testbot",
      "robot.villas",
      entries,
    );

    expect(result.published).toBe(0);
    expect(result.skipped).toBe(3);
    expect(mockInsertEntry).not.toHaveBeenCalled();
    expect(mockCtx.sendActivity).not.toHaveBeenCalled();
  });

  it("publishes entries with malformed links without throwing", async () => {
    const badEntries: FeedEntry[] = [
      { guid: "bad1", title: "Bad Link", link: "not a url", publishedAt: null },
      { guid: "bad2", title: "Relative", link: "/relative/path", publishedAt: null },
    ];

    const result = await publishNewEntries(
      mockCtx,
      {} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      "testbot",
      "robot.villas",
      badEntries,
    );

    expect(result.published).toBe(2);
    expect(mockInsertEntry).toHaveBeenCalledTimes(2);
    expect(mockCtx.sendActivity).toHaveBeenCalledTimes(2);
  });

  it("handles empty entries array", async () => {
    const result = await publishNewEntries(
      mockCtx,
      {} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      "testbot",
      "robot.villas",
      [],
    );

    expect(result.published).toBe(0);
    expect(result.skipped).toBe(0);
  });
});
