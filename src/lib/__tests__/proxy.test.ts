import { describe, it, expect, vi } from "vitest";
import { createFederation, MemoryKvStore } from "@fedify/fedify";

const federation = createFederation<void>({ kv: new MemoryKvStore() });
federation.setNodeInfoDispatcher("/nodeinfo/2.1", () => ({
  software: { name: "robot-villas", version: "1.0.0" },
  protocols: ["activitypub"],
  usage: { users: { total: 1 }, localPosts: 0, localComments: 0 },
}));

vi.mock("@/lib/globals", () => ({
  getGlobals: () => ({ federation, domain: "robot.test" }),
}));

const { default: proxy } = await import("@/proxy");

function get(path: string, accept: string): Request {
  return new Request(`https://robot.test${path}`, { headers: { accept } });
}

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
});
