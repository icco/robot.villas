import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  withBotAnnouncementLock: vi.fn(),
  getPendingBotAnnouncements: vi.fn(),
  markBotsAnnounced: vi.fn(),
  getFollowerRecipients: vi.fn(),
  getAcceptedRelays: vi.fn(),
  getEntryByGuid: vi.fn(),
  insertEntry: vi.fn(),
}));

import {
  withBotAnnouncementLock,
  getPendingBotAnnouncements,
  markBotsAnnounced,
  getFollowerRecipients,
  getAcceptedRelays,
  getEntryByGuid,
  insertEntry,
} from "../db";
import { parseConfig } from "../config";
import { announceNewBots } from "../meta-bot";

const config = parseConfig(`
meta: true
bots:
  newbot:
    feed_url: https://example.com/rss
    display_name: New <Bot>
    summary: A new feed
blocked_instances:
  - blocked.example
`);
const createdAt = new Date("2026-09-30T12:00:00Z");
const db = {} as never;
const sendActivity = vi.fn().mockResolvedValue(undefined);
const ctx = { sendActivity } as never;
const storedEntry = {
  id: 42,
  title: "New bot: New <Bot> (@newbot@robot.villas). A new feed",
  url: "https://robot.villas/@newbot",
  publishedAt: createdAt,
  hashtags: [],
};

describe("meta bot announcements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withBotAnnouncementLock).mockImplementation(async (_db, publish) => publish());
    vi.mocked(getPendingBotAnnouncements).mockResolvedValue([
      { botUsername: "newbot", createdAt, announcedAt: null },
    ]);
    vi.mocked(getEntryByGuid).mockResolvedValue(storedEntry);
    vi.mocked(insertEntry).mockResolvedValue(42);
    vi.mocked(getFollowerRecipients).mockResolvedValue([
      { followerId: "https://remote.example/user", sharedInboxUrl: "https://remote.example/inbox" },
      { followerId: "https://blocked.example/user", sharedInboxUrl: "https://blocked.example/inbox" },
    ]);
    vi.mocked(getAcceptedRelays).mockResolvedValue([]);
  });

  it("posts a profile link to allowed followers", async () => {
    await announceNewBots(ctx, db, config, "robot.villas");
    expect(getPendingBotAnnouncements).toHaveBeenCalledWith(db, ["newbot"]);
    expect(insertEntry).toHaveBeenCalledWith(
      db, "meta", "new-bot:newbot", "https://robot.villas/@newbot",
      "New bot: New <Bot> (@newbot@robot.villas). A new feed", createdAt, [],
    );
    expect(sendActivity).toHaveBeenCalledTimes(1);
    const [sender, recipients, activity] = sendActivity.mock.calls[0];
    expect(sender).toEqual({ identifier: "meta" });
    expect(recipients.map((r: { id: URL }) => r.id.href)).toEqual(["https://remote.example/user"]);
    const note = await activity.getObject();
    expect(note.content).toContain("New &lt;Bot&gt;");
    expect(note.content).toContain('href="https://robot.villas/@newbot"');
    expect(note.id.href).toBe("https://robot.villas/users/meta/posts/42");
    expect(note.toIds.map((url: URL) => url.href)).toContain("https://www.w3.org/ns/activitystreams#Public");
    expect(markBotsAnnounced).toHaveBeenCalledWith(db, ["newbot"]);
  });

  it("skips publishing when another worker holds the lock", async () => {
    vi.mocked(withBotAnnouncementLock).mockResolvedValueOnce(undefined);
    await announceNewBots(ctx, db, config, "robot.villas");
    expect(getPendingBotAnnouncements).not.toHaveBeenCalled();
    expect(insertEntry).not.toHaveBeenCalled();
    expect(sendActivity).not.toHaveBeenCalled();
    expect(markBotsAnnounced).not.toHaveBeenCalled();
  });

  it("reuses the stored activity after an interrupted state update", async () => {
    vi.mocked(markBotsAnnounced).mockRejectedValueOnce(new Error("database unavailable"));
    await expect(announceNewBots(ctx, db, config, "robot.villas")).rejects.toThrow("database unavailable");
    vi.mocked(insertEntry).mockResolvedValue(null);
    await announceNewBots(ctx, db, config, "robot.villas");
    expect(sendActivity).toHaveBeenCalledTimes(2);
    expect(await sendActivity.mock.calls[1][2].toJsonLd())
      .toEqual(await sendActivity.mock.calls[0][2].toJsonLd());
    expect(markBotsAnnounced).toHaveBeenCalledWith(db, ["newbot"]);
  });

  it.each(["follower", "relay"])("retries a failed %s send", async (target) => {
    if (target === "relay") {
      vi.mocked(getAcceptedRelays).mockResolvedValue([{
        id: 1, botUsername: "newbot", url: "https://relay.example/actor",
        actorId: "https://relay.example/actor", inboxUrl: "https://relay.example/inbox",
        status: "accepted", statusChangedAt: null, followActivityId: null,
      }]);
      sendActivity.mockResolvedValueOnce(undefined);
    }
    sendActivity.mockRejectedValueOnce(new Error("queue unavailable"));
    await announceNewBots(ctx, db, config, "robot.villas");
    expect(markBotsAnnounced).not.toHaveBeenCalled();
    const original = await sendActivity.mock.calls[0][2].toJsonLd();

    sendActivity.mockClear();
    vi.mocked(insertEntry).mockResolvedValue(null);
    const changedConfig = {
      ...config,
      bots: { ...config.bots, newbot: { ...config.bots.newbot, summary: "Changed" } },
    };
    await announceNewBots(ctx, db, changedConfig, "robot.villas");
    expect(await sendActivity.mock.calls[0][2].toJsonLd()).toEqual(original);
    expect(sendActivity).toHaveBeenCalledTimes(target === "relay" ? 2 : 1);
    expect(markBotsAnnounced).toHaveBeenCalledWith(db, ["newbot"]);
  });

  it("only completes successfully queued announcements", async () => {
    vi.mocked(getPendingBotAnnouncements).mockResolvedValue([
      { botUsername: "newbot", createdAt, announcedAt: null },
      { botUsername: "other", createdAt, announcedAt: null },
    ]);
    sendActivity.mockRejectedValueOnce(new Error("queue unavailable"));
    await announceNewBots(ctx, db, {
      ...config, bots: { ...config.bots, other: config.bots.newbot },
    }, "robot.villas");
    expect(markBotsAnnounced).toHaveBeenCalledExactlyOnceWith(db, ["other"]);
  });

  it("retries failed inserts", async () => {
    vi.mocked(insertEntry).mockRejectedValueOnce(new Error("database unavailable"));
    await expect(announceNewBots(ctx, db, config, "robot.villas")).rejects.toThrow("database unavailable");
    expect(markBotsAnnounced).not.toHaveBeenCalled();
    await announceNewBots(ctx, db, config, "robot.villas");
    expect(sendActivity).toHaveBeenCalledTimes(1);
    expect(markBotsAnnounced).toHaveBeenCalledWith(db, ["newbot"]);
  });

  it("stores posts without followers", async () => {
    vi.mocked(getFollowerRecipients).mockResolvedValue([]);
    await announceNewBots(ctx, db, config, "robot.villas");
    expect(insertEntry).toHaveBeenCalledTimes(1);
    expect(sendActivity).not.toHaveBeenCalled();
    expect(markBotsAnnounced).toHaveBeenCalledWith(db, ["newbot"]);
  });

  it("skips empty or disabled announcements", async () => {
    vi.mocked(getPendingBotAnnouncements).mockResolvedValue([]);
    await announceNewBots(ctx, db, config, "robot.villas");
    await announceNewBots(ctx, db, { ...config, meta: false }, "robot.villas");
    expect(getPendingBotAnnouncements).toHaveBeenCalledTimes(1);
    expect(insertEntry).not.toHaveBeenCalled();
    expect(markBotsAnnounced).not.toHaveBeenCalled();
  });
});
