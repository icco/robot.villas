import { describe, expect, it } from "vitest";
import { cacheResponses, MemoryResponseStore, RedisResponseStore, type ResponseStore } from "../response-cache";

const AP = "application/activity+json";

function handlerReturning(make: () => Response) {
  const calls: string[] = [];
  const handler = async (request: Request) => {
    calls.push(`${request.method} ${new URL(request.url).pathname}`);
    return make();
  };
  return { handler, calls };
}

const request = (path: string, method = "GET") =>
  new Request(`https://robot.test${path}`, { method, headers: { Accept: AP } });

const note = () => new Response(JSON.stringify({ type: "Note" }), { headers: { "Content-Type": AP, Vary: "Accept" } });

const options = (store: ResponseStore) => ({
  store,
  ttlMs: 3_600_000,
  cacheControl: "public, max-age=300",
  keyFor: (pathname: string) => (/^\/users\/alice\/posts\/\d+$/.test(pathname) ? pathname : null),
});

describe("cacheResponses", () => {
  it("serves a repeat fetch from the store with the same body and cache headers", async () => {
    const { handler, calls } = handlerReturning(note);
    const cached = cacheResponses(handler, options(new MemoryResponseStore({ max: 10 })));

    const first = await cached(request("/users/alice/posts/1"));
    const second = await cached(request("/users/alice/posts/1"));

    expect(calls).toEqual(["GET /users/alice/posts/1"]);
    expect(await second.json()).toEqual(await first.json());
    for (const res of [first, second]) {
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe(AP);
      expect(res.headers.get("Vary")).toBe("Accept");
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    }
  });

  it("shares one load between concurrent fetches of the same post", async () => {
    const { handler, calls } = handlerReturning(note);
    const cached = cacheResponses(handler, options(new MemoryResponseStore({ max: 10 })));

    const responses = await Promise.all([1, 2, 3].map(() => cached(request("/users/alice/posts/2"))));

    expect(calls).toHaveLength(1);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
  });

  it("gives each concurrent fetch its own readable response when the result is not cacheable", async () => {
    const { handler } = handlerReturning(() => new Response("not found", { status: 404 }));
    const cached = cacheResponses(handler, options(new MemoryResponseStore({ max: 10 })));

    const responses = await Promise.all([1, 2].map(() => cached(request("/users/alice/posts/8"))));

    expect(await Promise.all(responses.map((r) => r.text()))).toEqual(["not found", "not found"]);
  });

  it("does not keep tombstones, which a re-added bot's next poll revives", async () => {
    const { handler, calls } = handlerReturning(() => new Response("{}", { status: 410, headers: { "Content-Type": AP } }));
    const cached = cacheResponses(handler, options(new MemoryResponseStore({ max: 10 })));

    await cached(request("/users/alice/posts/3"));
    const second = await cached(request("/users/alice/posts/3"));

    expect(calls).toHaveLength(2);
    expect(second.status).toBe(410);
    expect(second.headers.get("Cache-Control")).toBeNull();
  });

  it.each([
    ["JRD", "application/jrd+json"],
    ["HTML first", "text/html, application/activity+json;q=0.9"],
  ])("leaves a %s request to content negotiation even when the post is cached", async (_name, accept) => {
    const { handler, calls } = handlerReturning(note);
    const cached = cacheResponses(handler, options(new MemoryResponseStore({ max: 10 })));
    await cached(request("/users/alice/posts/9"));

    await cached(new Request("https://robot.test/users/alice/posts/9", { headers: { Accept: accept } }));

    expect(calls).toHaveLength(2);
  });

  it("serves Mastodon's Accept header from the cache", async () => {
    const { handler, calls } = handlerReturning(note);
    const cached = cacheResponses(handler, options(new MemoryResponseStore({ max: 10 })));
    const mastodon = "application/activity+json, application/ld+json; profile=\"https://www.w3.org/ns/activitystreams\", text/html;q=0.1";

    await cached(request("/users/alice/posts/10"));
    const res = await cached(new Request("https://robot.test/users/alice/posts/10", { headers: { Accept: mastodon } }));

    expect(calls).toHaveLength(1);
    expect(res.status).toBe(200);
  });

  it.each([
    ["a path without a key", "/users/bob/posts/1", note],
    ["a 404", "/users/alice/posts/4", () => new Response(null, { status: 404 })],
    ["a non-ActivityPub response", "/users/alice/posts/5", () => new Response("<html>", { headers: { "Content-Type": "text/html" } })],
  ])("passes %s through uncached", async (_name, path, make) => {
    const { handler, calls } = handlerReturning(make);
    const cached = cacheResponses(handler, options(new MemoryResponseStore({ max: 10 })));

    const res = await cached(request(path));
    await cached(request(path));

    expect(calls).toHaveLength(2);
    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  it("answers HEAD from the store without a body, and does not store HEAD responses", async () => {
    const { handler, calls } = handlerReturning(note);
    const cached = cacheResponses(handler, options(new MemoryResponseStore({ max: 10 })));

    await cached(request("/users/alice/posts/6", "HEAD"));
    await cached(request("/users/alice/posts/6"));
    const head = await cached(request("/users/alice/posts/6", "HEAD"));

    expect(calls).toEqual(["HEAD /users/alice/posts/6", "GET /users/alice/posts/6"]);
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
  });

  it("still answers when the store fails", async () => {
    const broken: ResponseStore = {
      get: async () => {
        throw new Error("redis unavailable");
      },
      set: async () => {
        throw new Error("redis unavailable");
      },
    };
    const { handler, calls } = handlerReturning(note);
    const cached = cacheResponses(handler, options(broken));

    const res = await cached(request("/users/alice/posts/7"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: "Note" });
    expect(calls).toHaveLength(1);
  });
});

describe("RedisResponseStore", () => {
  it("stores JSON under a prefixed key with a millisecond TTL", async () => {
    const data = new Map<string, string>();
    const sets: unknown[][] = [];
    const redis = {
      get: async (key: string) => data.get(key) ?? null,
      set: async (...args: [string, string, string, number]) => {
        sets.push(args);
        data.set(args[0], args[1]);
        return "OK";
      },
    };
    const store = new RedisResponseStore(redis as unknown as ConstructorParameters<typeof RedisResponseStore>[0]);
    const entry = { status: 200, contentType: AP, body: "{}" };

    await store.set("/users/alice/posts/1", entry, 60_000);

    expect(sets).toEqual([["robot-villas:response:/users/alice/posts/1", JSON.stringify(entry), "PX", 60_000]]);
    expect(await store.get("/users/alice/posts/1")).toEqual(entry);
    expect(await store.get("/users/alice/posts/2")).toBeUndefined();
  });
});

describe("MemoryResponseStore", () => {
  it("drops entries after their TTL", async () => {
    let now = 1_000;
    const store = new MemoryResponseStore({ max: 10, perf: { now: () => now } });
    const entry = { status: 200, contentType: AP, body: "{}" };

    await store.set("k", entry, 60_000);
    now += 59_000;
    expect(await store.get("k")).toEqual(entry);
    now += 2_000;
    expect(await store.get("k")).toBeUndefined();
  });
});
