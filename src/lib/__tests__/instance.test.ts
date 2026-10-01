import { describe, expect, it } from "vitest";
import { interactionUrl, normalizeInstance, parseSuggestions } from "../instance";

describe("normalizeInstance", () => {
  it.each([
    ["mastodon.social", "mastodon.social"],
    [" Mastodon.Social ", "mastodon.social"],
    ["https://mastodon.social/", "mastodon.social"],
    ["@me@hachyderm.io", "hachyderm.io"],
    ["me@hachyderm.io", "hachyderm.io"],
    ["example.com:8443", "example.com:8443"],
  ])("accepts %j", (input, host) => expect(normalizeInstance(input)).toBe(host));

  it.each(["", "localhost", "http://mastodon.social", "javascript:alert(1)", "https://u:p@example.com", "example.com/path", "example.com?x=1", "evil.com#frag"])(
    "rejects %j",
    (input) => expect(normalizeInstance(input)).toBeNull(),
  );
});

describe("interactionUrl", () => {
  it("encodes the object or account as a query parameter", () => {
    expect(interactionUrl("mastodon.social", "https://robot.villas/users/a/posts/1?x=&y"))
      .toBe("https://mastodon.social/authorize_interaction?uri=https%3A%2F%2Frobot.villas%2Fusers%2Fa%2Fposts%2F1%3Fx%3D%26y");
    expect(interactionUrl("mastodon.social", "@bot@robot.villas")).toContain("uri=%40bot%40robot.villas");
  });
});

describe("parseSuggestions", () => {
  it("keeps only hostnames from an array", () => {
    expect(parseSuggestions(["a.example", 3, "javascript:x", "b.example/x", "c.example"])).toEqual(["a.example", "c.example"]);
    expect(parseSuggestions({ error: "x" })).toEqual([]);
    expect(parseSuggestions(null)).toEqual([]);
  });
});
