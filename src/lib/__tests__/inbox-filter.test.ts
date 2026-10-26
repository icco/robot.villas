import { describe, it, expect } from "vitest";
import { isForeignAnnounce } from "../inbox-filter";

const origin = "https://robot.test";

function post(path: string, activity: unknown): Request {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/activity+json" },
    body: typeof activity === "string" ? activity : JSON.stringify(activity),
  });
}

describe("isForeignAnnounce", () => {
  it("matches a relay's Announce of another server's post on the shared inbox", async () => {
    const request = post("/inbox", { type: "Announce", object: "https://elsewhere.example/notes/1" });
    expect(await isForeignAnnounce(request, origin)).toBe(true);
  });

  it("matches an embedded foreign object on a bot inbox", async () => {
    const request = post("/users/hackernews/inbox", { type: "Announce", object: { id: "https://elsewhere.example/notes/1" } });
    expect(await isForeignAnnounce(request, origin)).toBe(true);
  });

  it("keeps boosts of our own posts", async () => {
    const request = post("/inbox", { type: "Announce", object: `${origin}/users/hackernews/posts/1` });
    expect(await isForeignAnnounce(request, origin)).toBe(false);
  });

  it("keeps other activity types", async () => {
    const request = post("/inbox", { type: "Undo", object: "https://elsewhere.example/notes/1" });
    expect(await isForeignAnnounce(request, origin)).toBe(false);
  });

  it("keeps requests outside the inboxes", async () => {
    const request = post("/users/hackernews/outbox", { type: "Announce", object: "https://elsewhere.example/notes/1" });
    expect(await isForeignAnnounce(request, origin)).toBe(false);
  });

  it("leaves unreadable bodies for Fedify to reject", async () => {
    expect(await isForeignAnnounce(post("/inbox", "{not json"), origin)).toBe(false);
  });

  it("leaves the body readable for Fedify", async () => {
    const request = post("/inbox", { type: "Announce", object: `${origin}/users/hackernews/posts/1` });
    await isForeignAnnounce(request, origin);
    expect(await request.json()).toMatchObject({ type: "Announce" });
  });
});
