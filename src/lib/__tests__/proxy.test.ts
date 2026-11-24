import { describe, it, expect, vi } from "vitest";
import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { Application, Note } from "@fedify/vocab";
import { MemoryResponseStore } from "../response-cache";

const federation = createFederation<void>({ kv: new MemoryKvStore() });
federation.setNodeInfoDispatcher("/nodeinfo/2.1", () => ({
  software: { name: "robot-villas", version: "1.0.0" },
  protocols: ["activitypub"],
  usage: { users: { total: 1 }, localPosts: 0, localComments: 0 },
}));
federation.setActorDispatcher("/users/{identifier}", (ctx, identifier) =>
  new Application({ id: ctx.getActorUri(identifier), preferredUsername: identifier }));
const noteLoads: string[] = [];
federation.setObjectDispatcher(Note, "/users/{identifier}/posts/{id}", (ctx, values) => {
  noteLoads.push(`${values.identifier}/${values.id}`);
  return new Note({ id: ctx.getObjectUri(Note, values), content: "Hello" });
});

const responseStore = new MemoryResponseStore({ max: 10 });

vi.mock("@/lib/globals", () => ({
  getGlobals: () => ({ federation, domain: "robot.test", config: { bots: { alice: {} } }, responseStore }),
}));

const { default: proxy } = await import("@/proxy");

function get(path: string, accept: string): Request {
  return new Request(`https://robot.test${path}`, { headers: { accept } });
}

const AP = "application/activity+json";

describe("proxy", () => {
  it.each(["application/json", "*/*"])("serves NodeInfo to clients sending Accept: %s", async (accept) => {
    const response = (await proxy(get("/nodeinfo/2.1", accept))) as Response;
    expect(response.status).toBe(200);
    expect((await response.json()).software.name).toBe("robot-villas");
  });

  it("serves the NodeInfo discovery document that links to it", async () => {
    const response = (await proxy(get("/.well-known/nodeinfo", "application/json"))) as Response;
    expect(response.status).toBe(200);
    expect((await response.json()).links[0].href).toBe("https://robot.test/nodeinfo/2.1");
  });

  it("caches a bot's posts and marks them cacheable for shared caches", async () => {
    const first = (await proxy(get("/users/alice/posts/1", AP))) as Response;
    const second = (await proxy(get("/users/alice/posts/1", AP))) as Response;

    expect(noteLoads.filter((k) => k === "alice/1")).toHaveLength(1);
    expect((await second.json()).content).toBe("Hello");
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(second.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  it("does not cache posts of a bot that is no longer configured", async () => {
    await proxy(get("/users/removed/posts/1", AP));
    await proxy(get("/users/removed/posts/1", AP));

    expect(noteLoads.filter((k) => k === "removed/1")).toHaveLength(2);
  });

  it("marks actors cacheable without caching them", async () => {
    const response = (await proxy(get("/users/alice", AP))) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=180");
  });
});
