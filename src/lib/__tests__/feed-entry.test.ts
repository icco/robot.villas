import { describe, expect, it } from "vitest";
import { entryObjectUrl } from "../feed-entry";

describe("entryObjectUrl", () => {
  it("matches the same new URL(…, origin) shape as buildCreateActivity’s Note id", () => {
    const domain = "robot.villas";
    const origin = `https://${domain}`;
    const noteHref = new URL(
      "/users/hacker_news/posts/42",
      origin,
    ).href;
    expect(entryObjectUrl(domain, "hacker_news", 42)).toBe(noteHref);
  });
});
