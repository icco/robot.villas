import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.js", () => ({
  insertEntry: vi.fn(),
  getFollowers: vi.fn(),
  getFollowerRecipients: vi.fn(),
  getAcceptedRelays: vi.fn(),
}));

import { insertEntry, getFollowers, getFollowerRecipients, getAcceptedRelays } from "../db.js";
import {
  buildCreateActivity,
  MAX_GUID_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  publishNewEntries,
  safeParseUrl,
  truncateToMax,
  formatContent,
} from "../publisher.js";
import type { FeedEntry } from "../rss.js";

const mockInsertEntry = vi.mocked(insertEntry);
const mockGetFollowers = vi.mocked(getFollowers);
const mockGetFollowerRecipients = vi.mocked(getFollowerRecipients);
const mockGetAcceptedRelays = vi.mocked(getAcceptedRelays);

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
    mockInsertEntry.mockResolvedValue(1);
    mockGetFollowers.mockResolvedValue(["https://remote.example/user/1"]);
    mockGetFollowerRecipients.mockResolvedValue([
      { followerId: "https://remote.example/user/1", sharedInboxUrl: "https://remote.example/inbox" },
    ]);
    mockGetAcceptedRelays.mockResolvedValue([]);
  });

  it("publishes new entries and skips existing ones", async () => {
    mockInsertEntry
      .mockResolvedValueOnce(null) // g1 already exists (conflict)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

    const result = await publishNewEntries(
      mockCtx,
      {} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      "testbot",
      "robot.villas",
      entries,
    );

    expect(result.skipped).toBe(1);
    expect(result.published).toBe(2);
    expect(mockInsertEntry).toHaveBeenCalledTimes(3);
    expect(mockCtx.sendActivity).toHaveBeenCalledTimes(2);
  });

  it("inserts entries but does not send when there are no followers", async () => {
    mockGetFollowers.mockResolvedValue([]);
    mockGetFollowerRecipients.mockResolvedValue([]);
    mockInsertEntry.mockResolvedValue(1);

    const result = await publishNewEntries(
      mockCtx,
      {} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      "testbot",
      "robot.villas",
      entries,
    );

    expect(result.published).toBe(0);
    expect(result.skipped).toBe(3);
    expect(mockInsertEntry).toHaveBeenCalledTimes(3);
    expect(mockCtx.sendActivity).not.toHaveBeenCalled();
  });

  it("skips all entries when all already exist", async () => {
    mockInsertEntry.mockResolvedValue(null);

    const result = await publishNewEntries(
      mockCtx,
      {} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      "testbot",
      "robot.villas",
      entries,
    );

    expect(result.published).toBe(0);
    expect(result.skipped).toBe(3);
    expect(mockInsertEntry).toHaveBeenCalledTimes(3);
    expect(mockCtx.sendActivity).not.toHaveBeenCalled();
  });

  it("publishes entries with malformed links without throwing", async () => {
    const badEntries: FeedEntry[] = [
      { guid: "bad1", title: "Bad Link", link: "not a url", publishedAt: null },
      { guid: "bad2", title: "Relative", link: "/relative/path", publishedAt: null },
    ];
    mockInsertEntry.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

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

  it("continues publishing remaining entries if follower send throws", async () => {
    mockInsertEntry.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    mockCtx.sendActivity.mockRejectedValueOnce(new Error("network error")).mockResolvedValue(undefined);

    const result = await publishNewEntries(
      mockCtx,
      {} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      "testbot",
      "robot.villas",
      entries,
    );

    // All three entries should be marked published (error is caught, not propagated)
    expect(result.published).toBe(3);
    expect(result.skipped).toBe(0);
    expect(mockCtx.sendActivity).toHaveBeenCalledTimes(3);
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

describe("safeParseUrl", () => {
  it("returns undefined for javascript:, data:, and vbscript:", () => {
    expect(safeParseUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeParseUrl("data:text/html,<script>")).toBeUndefined();
    expect(safeParseUrl("vbscript:msgbox(1)")).toBeUndefined();
  });

  it("returns URL for http and https only", () => {
    expect(safeParseUrl("https://example.com")?.href).toBe("https://example.com/");
    expect(safeParseUrl("http://example.com/path")?.href).toBe("http://example.com/path");
  });

  it("returns undefined for invalid or empty input", () => {
    expect(safeParseUrl("not a url")).toBeUndefined();
    expect(safeParseUrl("")).toBeUndefined();
    expect(safeParseUrl(undefined)).toBeUndefined();
  });
});

describe("buildCreateActivity", () => {
  const baseUrl = "https://robot.villas";

  async function getNoteContent(create: Awaited<ReturnType<typeof buildCreateActivity>>): Promise<{ url?: URL; content?: string } | null> {
    const note = await (create as { getObject?: () => Promise<unknown> }).getObject?.();
    return note as { url?: URL; content?: string } | null;
  }

  it("does not put javascript: or data: in Note url or content href", async () => {
    const create = buildCreateActivity(
      "testbot",
      1,
      { title: "X", link: "javascript:alert(1)", publishedAt: null },
      baseUrl,
    );
    const note = await getNoteContent(create);
    expect(note).not.toBeNull();
    expect(note!.url == null).toBe(true);
    expect(note!.content).not.toContain("javascript:");
    expect(note!.content).not.toMatch(/<a href=/);
  });

  it("uses https link in Note url and content when link is safe", async () => {
    const create = buildCreateActivity(
      "testbot",
      2,
      { title: "OK", link: "https://example.com/ok", publishedAt: null },
      baseUrl,
    );
    const note = await getNoteContent(create);
    expect(note).not.toBeNull();
    expect(note!.url?.href).toBe("https://example.com/ok");
    expect(note!.content).toContain("https://example.com/ok");
    expect(note!.content).toContain("<a href=");
  });

  it("escapes HTML in title and link (quotes and angle brackets)", async () => {
    const create = buildCreateActivity(
      "testbot",
      3,
      {
        title: 'Say "hello" <script>',
        link: "https://example.com",
        publishedAt: null,
      },
      baseUrl,
    );
    const note = await getNoteContent(create);
    expect(note).not.toBeNull();
    expect(note!.content).toContain("&quot;");
    expect(note!.content).toContain("&lt;script&gt;");
    expect(note!.content).not.toContain("<script>");
  });

  it("escapes single quote in title", async () => {
    const create = buildCreateActivity(
      "testbot",
      4,
      { title: "It's a test", link: "", publishedAt: null },
      baseUrl,
    );
    const note = await getNoteContent(create);
    expect(note).not.toBeNull();
    expect(note!.content).toContain("&#39;");
    expect(note!.content).toContain("It&#39;s a test");
  });
});

describe("truncateToMax", () => {
  it("returns string unchanged when within limit", () => {
    expect(truncateToMax("short", 10)).toBe("short");
    expect(truncateToMax("exactly10!", 10)).toBe("exactly10!");
  });

  it("truncates to max length when over", () => {
    expect(truncateToMax("hello world", 5)).toBe("hello");
    expect(truncateToMax("x".repeat(3000), MAX_TITLE_LENGTH)).toHaveLength(MAX_TITLE_LENGTH);
  });
});

describe("publishNewEntries with length limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertEntry.mockResolvedValue(1);
    mockGetFollowers.mockResolvedValue(["https://remote.example/user/1"]);
    mockGetFollowerRecipients.mockResolvedValue([
      { followerId: "https://remote.example/user/1", sharedInboxUrl: "https://remote.example/inbox" },
    ]);
    mockGetAcceptedRelays.mockResolvedValue([]);
  });

  it("truncates over-long title, link, and guid before insert and in Note", async () => {
    const longTitle = "a".repeat(MAX_TITLE_LENGTH + 100);
    const longLink = "https://example.com/" + "b".repeat(MAX_URL_LENGTH);
    const longGuid = "c".repeat(MAX_URL_LENGTH + 50);
    const entries: FeedEntry[] = [
      { guid: longGuid, title: longTitle, link: longLink, publishedAt: null },
    ];

    await publishNewEntries(
      mockCtx,
      {} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      "testbot",
      "robot.villas",
      entries,
    );

    expect(mockInsertEntry).toHaveBeenCalledTimes(1);
    const [, , guid, url, title] = mockInsertEntry.mock.calls[0]!;
    expect(guid).toHaveLength(MAX_GUID_LENGTH);
    expect(url).toHaveLength(MAX_URL_LENGTH);
    expect(title).toHaveLength(MAX_TITLE_LENGTH);
    expect(mockCtx.sendActivity).toHaveBeenCalledTimes(1);
    const create = mockCtx.sendActivity.mock.calls[0]![2] as { getObject?: () => Promise<{ content?: string }> };
    const note = create.getObject ? await create.getObject() : null;
    expect(note?.content).toBeDefined();
    expect(note!.content).toContain("a".repeat(MAX_TITLE_LENGTH).slice(0, 50));
    expect(note!.content).toContain("https://example.com/");
  });
});

describe("formatContent", () => {
  it("includes link in anchor tag for valid https url", () => {
    const content = formatContent({ title: "My Post", link: "https://example.com/post", publishedAt: null });
    expect(content).toBe('<p>My Post</p><p><a href="https://example.com/post">https://example.com/post</a></p>');
  });

  it("omits link for unsafe url schemes", () => {
    const content = formatContent({ title: "My Post", link: "javascript:alert(1)", publishedAt: null });
    expect(content).toBe("<p>My Post</p>");
  });

  it("omits link when link is empty", () => {
    const content = formatContent({ title: "No Link", link: "", publishedAt: null });
    expect(content).toBe("<p>No Link</p>");
  });

  it("escapes HTML in title and link", () => {
    const content = formatContent({ title: '<b>Test</b>', link: "https://example.com/", publishedAt: null });
    expect(content).not.toContain("<b>");
    expect(content).toContain("&lt;b&gt;");
  });
});
