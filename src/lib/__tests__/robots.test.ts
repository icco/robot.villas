import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFeedWithHttpResult } from "../rss";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

const feed = `<rss version="2.0"><channel><title>Test</title><item><title>Ada's post</title><guid>ada-1</guid></item></channel></rss>`;

describe("feed robots policy", () => {
  it.each([
    ["User-agent: *\nDisallow: /feed", "/feed.xml", true],
    ["User-agent: *\nDisallow: /private", "/feed.xml", false],
    ["User-agent: OtherBot\nDisallow: /", "/feed.xml", false],
    ["User-agent: *\nDisallow:", "/feed.xml", false],
    ["not a robots file", "/feed.xml", false],
    ["User-agent: *\nDisallow: /\nAllow: /feed", "/feed.xml", false],
    ["User-agent: *\nDisallow: /feed\nAllow: /feed", "/feed.xml", false],
    ["User-agent: *\nDisallow: /*.xml$", "/feed.xml", true],
    ["User-agent: *\nDisallow: /*.xml$", "/feed.xml?public=1", false],
    ["User-agent: ROBOTVILLAS\nDisallow: /", "/feed.xml", true],
    ["User-agent: *\nDisallow: /\nUser-agent: RobotVillas", "/feed.xml", false],
    ["User-agent: *\nDisallow: /feed", "/%66eed.xml", true],
    ["User-agent: *\nDisallow: /\nAllow: /feed", "/%66eed.xml", false],
    ["User-agent: *\nDisallow: /%66eed", "/feed.xml", true],
    ["User-agent: *\nDisallow: /feed%2F", "/feed/one", false],
    ["User-agent: *\nDisallow: /\nUser-agent: RobotVillas\nDisallow:", "/feed.xml", false],
    ["User-agent: RobotVillas\nDisallow: /other\nUser-agent: RobotVillas\nDisallow: /feed", "/feed.xml", true],
  ])("uses matching rules from %s for %s", async (robots, path, blocked) => {
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      requested.push(String(input));
      return new Response(new URL(String(input)).pathname === "/robots.txt" ? robots : feed);
    };
    const result = await fetchFeedWithHttpResult(`https://example.com${path}`);
    if (blocked) {
      expect(result.errorMessage).toMatch(/robots\.txt/);
      expect(result.entries).toEqual([]);
      expect(result.httpStatus).toBeNull();
      expect(result.validators).toBeNull();
      expect(requested).toEqual(["https://example.com/robots.txt"]);
    } else {
      expect(result.errorMessage).toBeNull();
      expect(result.entries[0]?.guid).toBe("ada-1");
    }
  });

  it.each([404, 403, 429, 500, 503])("ignores robots HTTP %s even with a disallow body", async (status) => {
    globalThis.fetch = async (input) => new URL(String(input)).pathname === "/robots.txt"
      ? new Response("User-agent: *\nDisallow: /", { status })
      : new Response(feed);
    expect((await fetchFeedWithHttpResult("https://example.com/feed.xml")).entries[0]?.guid).toBe("ada-1");
  });

  it("continues after a robots network error", async () => {
    globalThis.fetch = async (input) => {
      if (new URL(String(input)).pathname === "/robots.txt") {
        throw new Error("connection failed");
      }
      return new Response(feed);
    };
    expect((await fetchFeedWithHttpResult("https://example.com/feed.xml")).entries[0]?.guid).toBe("ada-1");
  });

  it("continues after the robots check times out", async () => {
    vi.useFakeTimers();
    globalThis.fetch = async (input, init) => {
      if (new URL(String(input)).pathname === "/robots.txt") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("robots timeout")), { once: true });
        });
      }
      return new Response(feed);
    };
    const result = fetchFeedWithHttpResult("https://example.com/feed.xml");
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await result).entries[0]?.guid).toBe("ada-1");
  });

  it("continues when robots exceeds its byte limit", async () => {
    globalThis.fetch = async (input) => new Response(new URL(String(input)).pathname === "/robots.txt"
      ? "#".repeat(500 * 1024 + 1)
      : feed);
    expect((await fetchFeedWithHttpResult("https://example.com/feed.xml")).entries[0]?.guid).toBe("ada-1");
  });

  it("preserves the feed timeout budget after robots timeouts on redirected origins", async () => {
    vi.useFakeTimers();
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/robots.txt") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("robots timeout")), { once: true });
        });
      }
      if (url.hostname === "example.com") {
        return new Response(null, { status: 302, headers: { location: "https://other.example/feed.xml" } });
      }
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response(feed)), 8_500);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("feed timeout"));
        }, { once: true });
      });
    };
    const result = fetchFeedWithHttpResult("https://example.com/feed.xml");
    await vi.advanceTimersByTimeAsync(12_500);
    expect((await result).entries[0]?.guid).toBe("ada-1");
  });

  it("rejects private robots redirects without preventing the public feed fetch", async () => {
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      requested.push(String(input));
      return new URL(String(input)).pathname === "/robots.txt"
        ? new Response(null, { status: 302, headers: { location: "http://127.0.0.1/rules" } })
        : new Response(feed);
    };
    expect((await fetchFeedWithHttpResult("https://example.com/feed.xml")).entries[0]?.guid).toBe("ada-1");
    expect(requested).not.toContain("http://127.0.0.1/rules");
  });

  it.each(["https://example.com/private", "https://other.example/private"])("does not fetch blocked redirect %s", async (target) => {
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      requested.push(url.href);
      if (url.pathname === "/robots.txt") {
        return new Response("User-agent: *\nDisallow: /private");
      }
      return url.pathname === "/feed.xml"
        ? new Response(null, { status: 302, headers: { location: target } })
        : new Response(feed);
    };
    const result = await fetchFeedWithHttpResult("https://example.com/feed.xml");
    expect(result.errorMessage).toMatch(/robots\.txt/);
    expect(requested).not.toContain(target);
  });

  it("applies redirected robots rules to the original host without sending feed validators", async () => {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/robots.txt") {
        expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
        expect(new Headers(init?.headers).get("user-agent")).toMatch(/robot\.villas/);
        return new Response(null, { status: 302, headers: { location: "https://policy.example/rules" } });
      }
      return new Response(url.pathname === "/rules" ? "User-agent: *\nDisallow: /feed" : feed);
    };
    const result = await fetchFeedWithHttpResult("https://example.com/feed.xml", { etag: '"cached"', lastModified: null });
    expect(result.errorMessage).toMatch(/robots\.txt/);
  });
});
