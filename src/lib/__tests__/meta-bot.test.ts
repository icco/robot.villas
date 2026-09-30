import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getPendingBotAnnouncements: vi.fn(),
  markBotsAnnounced: vi.fn(),
  getFollowerRecipients: vi.fn(),
  getAcceptedRelays: vi.fn(),
  getExistingGuids: vi.fn(),
  insertEntry: vi.fn(),
}));

import {
  getPendingBotAnnouncements,
  markBotsAnnounced,
  getFollowerRecipients,
  getAcceptedRelays,
  getExistingGuids,
  insertEntry,
} from "../db";
import { parseConfig } from "../config";
import { announceNewBots } from "../meta-bot";

const config = parseConfig(`
bots:
  meta:
    type: meta
    display_name: Meta
    summary: New accounts
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

describe("meta bot announcements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPendingBotAnnouncements).mockResolvedValue([
      { botUsername: "newbot", createdAt, announcedAt: null },
    ]);
    vi.mocked(getExistingGuids).mockImplementation(async () => new Set());
    vi.mocked(insertEntry).mockResolvedValue(42);
    vi.mocked(getFollowerRecipients).mockResolvedValue([
      { followerId: "https://remote.example/user", sharedInboxUrl: "https://remote.example/inbox" },
      { followerId: "https://blocked.example/user", sharedInboxUrl: "https://blocked.example/inbox" },
    ]);
    vi.mocked(getAcceptedRelays).mockResolvedValue([]);
  });

  it("stores a public post, links the new profile, and delivers to allowed followers", async () => {
    await announceNewBots(ctx, db, config, "robot.villas");
    expect(getPendingBotAnnouncements).toHaveBeenCalledWith(db, ["newbot"]);
    expect(insertEntry).toHaveBeenCalledWith(
      db, "meta", "new-bot:newbot", "https://robot.villas/@newbot",
      "Welcome New <Bot> (@newbot@robot.villas) to robot.villas! A new feed", createdAt, [],
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

  it("does not duplicate a post if publishing succeeded before an interrupted state update", async () => {
    vi.mocked(getExistingGuids).mockResolvedValue(new Set(["new-bot:newbot"]));
    await announceNewBots(ctx, db, config, "robot.villas");
    expect(insertEntry).not.toHaveBeenCalled();
    expect(sendActivity).not.toHaveBeenCalled();
    expect(markBotsAnnounced).toHaveBeenCalledWith(db, ["newbot"]);
  });

  it("leaves failed inserts pending so the next cycle can retry", async () => {
    vi.mocked(insertEntry).mockRejectedValueOnce(new Error("database unavailable"));
    await expect(announceNewBots(ctx, db, config, "robot.villas")).rejects.toThrow("database unavailable");
    expect(markBotsAnnounced).not.toHaveBeenCalled();
    await announceNewBots(ctx, db, config, "robot.villas");
    expect(sendActivity).toHaveBeenCalledTimes(1);
    expect(markBotsAnnounced).toHaveBeenCalledWith(db, ["newbot"]);
  });

  it("stores announcements even before the meta bot has followers", async () => {
    vi.mocked(getFollowerRecipients).mockResolvedValue([]);
    await announceNewBots(ctx, db, config, "robot.villas");
    expect(insertEntry).toHaveBeenCalledTimes(1);
    expect(sendActivity).not.toHaveBeenCalled();
    expect(markBotsAnnounced).toHaveBeenCalledWith(db, ["newbot"]);
  });

  it("does nothing when there are no new accounts or no meta bot", async () => {
    vi.mocked(getPendingBotAnnouncements).mockResolvedValue([]);
    await announceNewBots(ctx, db, config, "robot.villas");
    await announceNewBots(ctx, db, { ...config, bots: { newbot: config.bots.newbot } }, "robot.villas");
    expect(getPendingBotAnnouncements).toHaveBeenCalledTimes(1);
    expect(insertEntry).not.toHaveBeenCalled();
    expect(markBotsAnnounced).not.toHaveBeenCalled();
  });
});
