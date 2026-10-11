import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/.well-known/http-message-signatures-directory/route";
import { fetchRemote } from "../remote-fetch";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const jwk = publicKey.export({ format: "jwk" });
const keyid = createHash("sha256").update(`{"crv":"Ed25519","kty":"OKP","x":"${jwk.x}"}`).digest("base64url");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function configure() {
  vi.stubEnv("WEB_BOT_AUTH_PRIVATE_KEY", pem);
  vi.stubEnv("DOMAIN", "robot.villas");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
}

function verifySignature(headers: Headers, lines: string[], key = publicKey) {
  const input = headers.get("signature-input")!;
  expect(input).toContain(`;keyid="${keyid}"`);
  expect(input).toContain(";created=1791720000;expires=1791720060");
  const nonce = input.match(/;nonce="([^"]+)"/)![1];
  expect(Buffer.from(nonce, "base64url")).toHaveLength(64);
  const params = input.slice(input.indexOf("=") + 1);
  const signature = headers.get("signature")!.match(/^sig1=:(.+):$/)![1];
  const base = [...lines, `"@signature-params": ${params}`].join("\n");
  expect(verify(null, Buffer.from(base), key, Buffer.from(signature, "base64"))).toBe(true);
  expect(verify(null, Buffer.from(base.replace("robot.villas", "mirror.example")), key, Buffer.from(signature, "base64"))).toBe(false);
}

describe("Web Bot Auth directory", () => {
  it("serves only the public JWK with a Host-bound, body-bound directory signature", async () => {
    configure();
    const response = await GET(new Request("http://localhost:8080/.well-known/http-message-signatures-directory", {
      headers: { Host: "robot.villas", Accept: "application/http-message-signatures-directory+json" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/http-message-signatures-directory+json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ keys: [{ kty: "OKP", crv: "Ed25519", x: jwk.x }] });
    const digest = `sha-256=:${createHash("sha256").update(body).digest("base64")}:`;
    expect(response.headers.get("content-digest")).toBe(digest);
    expect(response.headers.get("signature-input")).toContain(';tag="http-message-signatures-directory"');
    verifySignature(response.headers, [
      '"@authority";req: robot.villas',
      '"content-type": application/http-message-signatures-directory+json',
      `"content-digest": ${digest}`,
    ], createPublicKey({ key: JSON.parse(body).keys[0], format: "jwk" }));
  });

  it("does not publish an empty directory when no key is configured", async () => {
    vi.stubEnv("WEB_BOT_AUTH_PRIVATE_KEY", "");
    const response = await GET(new Request("https://robot.villas/.well-known/http-message-signatures-directory"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["invalid PEM", generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString()])(
    "rejects invalid or non-Ed25519 signing configuration",
    async (key) => {
      configure();
      vi.stubEnv("WEB_BOT_AUTH_PRIVATE_KEY", key);
      await expect(GET(new Request("https://robot.villas/.well-known/http-message-signatures-directory"))).rejects.toThrow();
    },
  );
});

describe("Web Bot Auth remote fetching", () => {
  it("re-signs each HTTPS redirect while preserving the feed identity and same-origin validators", async () => {
    configure();
    const seen: Array<{ url: URL; headers: Headers }> = [];
    vi.stubGlobal("fetch", async (input: URL, init: RequestInit) => {
      const url = new URL(input);
      const headers = new Headers(init.headers);
      seen.push({ url, headers });
      expect(headers.get("signature-agent")).toBe('"https://robot.villas"');
      expect(headers.get("signature-input")).toContain(';tag="web-bot-auth"');
      verifySignature(headers, [`"@authority": ${url.host}`, '"signature-agent": "https://robot.villas"']);
      return seen.length < 3
        ? new Response(null, { status: 302, headers: { location: seen.length === 1 ? "/next" : "https://other.example/feed" } })
        : new Response("feed");
    });
    const response = await fetchRemote("https://feed.example/rss", {
      signal: new AbortController().signal,
      headers: { "User-Agent": "robot.villas RSS poller/1.0", "If-None-Match": '"feed-v1"' },
    });
    expect(await response.text()).toBe("feed");
    expect(seen[1].headers.get("if-none-match")).toBe('"feed-v1"');
    expect(seen[2].headers.has("if-none-match")).toBe(false);
    expect(seen[2].headers.get("user-agent")).toBe("robot.villas RSS poller/1.0");
    expect(new Set(seen.map(({ headers }) => headers.get("signature"))).size).toBe(3);
  });

  it("strips signatures when a redirect downgrades to HTTP", async () => {
    configure();
    vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
      const headers = new Headers(init.headers);
      if (url.protocol === "https:") {
        return new Response(null, { status: 302, headers: { location: "http://feed.example/rss" } });
      }
      expect(headers.has("signature")).toBe(false);
      expect(headers.has("signature-input")).toBe(false);
      expect(headers.has("signature-agent")).toBe(false);
      return new Response("feed");
    });
    expect(await (await fetchRemote("https://feed.example/rss", { signal: new AbortController().signal })).text()).toBe("feed");
  });

  it("keeps unconfigured fetches unsigned", async () => {
    vi.stubEnv("WEB_BOT_AUTH_PRIVATE_KEY", "");
    vi.stubGlobal("fetch", async (_url: URL, init: RequestInit) => {
      expect(new Headers(init.headers).has("signature")).toBe(false);
      return new Response("feed");
    });
    expect(await (await fetchRemote("https://feed.example/rss", { signal: new AbortController().signal })).text()).toBe("feed");
  });

  it("fails configured fetches rather than silently using an invalid key", async () => {
    configure();
    vi.stubEnv("WEB_BOT_AUTH_PRIVATE_KEY", "invalid");
    vi.stubGlobal("fetch", async () => new Response("unsigned request must not succeed"));
    await expect(fetchRemote("https://feed.example/rss", { signal: new AbortController().signal })).rejects.toThrow();
  });
});
