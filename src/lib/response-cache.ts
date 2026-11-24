import { getLogger } from "@logtape/logtape";
import type { Redis } from "ioredis";
import { LRUCache, type Perf } from "lru-cache";
import Negotiator from "negotiator";

const logger = getLogger(["robot-villas", "response-cache"]);

export interface CachedResponse {
  status: number;
  contentType: string;
  body: string;
}

export interface ResponseStore {
  get(key: string): Promise<CachedResponse | undefined>;
  set(key: string, value: CachedResponse, ttlMs: number): Promise<void>;
}

export class RedisResponseStore implements ResponseStore {
  constructor(private readonly redis: Redis, private readonly prefix = "robot-villas:response:") {}

  async get(key: string): Promise<CachedResponse | undefined> {
    const raw = await this.redis.get(this.prefix + key);
    return raw == null ? undefined : (JSON.parse(raw) as CachedResponse);
  }

  async set(key: string, value: CachedResponse, ttlMs: number): Promise<void> {
    await this.redis.set(this.prefix + key, JSON.stringify(value), "PX", ttlMs);
  }
}

export class MemoryResponseStore implements ResponseStore {
  private readonly cache: LRUCache<string, CachedResponse>;

  constructor(options: { max: number; perf?: Perf }) {
    this.cache = new LRUCache({ max: options.max, perf: options.perf, ...(options.perf && { ttlResolution: 0 }) });
  }

  async get(key: string): Promise<CachedResponse | undefined> {
    return this.cache.get(key);
  }

  async set(key: string, value: CachedResponse, ttlMs: number): Promise<void> {
    this.cache.set(key, value, { ttl: ttlMs });
  }
}

/** Mirrors Fedify's internal acceptsJsonLd(), which decides whether a request gets ActivityPub or falls through. */
function acceptsJsonLd(request: Request): boolean {
  const types = new Negotiator({ headers: { accept: request.headers.get("Accept") ?? "*/*" } }).mediaTypes();
  if (types[0] === "text/html" || types[0] === "application/xhtml+xml") {
    return false;
  }
  return types.some((t) => t === "application/activity+json" || t === "application/ld+json" || t === "application/json");
}

/**
 * Serves ActivityPub GET and HEAD responses for paths `keyFor` names from
 * `store`, so one load answers every fetch of the same document until `ttlMs`
 * passes. Only 200 activity+json responses are kept, since a re-added bot's
 * poll revives its tombstoned posts. Requests that would not get ActivityPub
 * skip the cache, and a failing store falls back to `handler`.
 */
export function cacheResponses(
  handler: (request: Request) => Promise<Response>,
  options: { store: ResponseStore; ttlMs: number; cacheControl: string; keyFor: (pathname: string) => string | null },
): (request: Request) => Promise<Response> {
  const { store, ttlMs, cacheControl, keyFor } = options;
  const inflight = new Map<string, Promise<CachedResponse | null>>();

  const toResponse = (entry: CachedResponse, method: string) =>
    new Response(method === "HEAD" ? null : entry.body, {
      status: entry.status,
      headers: { "Content-Type": entry.contentType, Vary: "Accept", "Cache-Control": cacheControl },
    });

  const load = async (request: Request, key: string): Promise<CachedResponse | Response> => {
    try {
      const hit = await store.get(key);
      if (hit) {
        return hit;
      }
    } catch (error) {
      logger.warn("Response cache read failed for {key}: {error}", { key, error });
    }
    const response = await handler(request);
    const contentType = response.headers.get("Content-Type") ?? "";
    if (response.status !== 200 || !contentType.includes("application/activity+json")) {
      return response;
    }
    const entry = { status: response.status, contentType, body: await response.text() };
    try {
      await store.set(key, entry, ttlMs);
    } catch (error) {
      logger.warn("Response cache write failed for {key}: {error}", { key, error });
    }
    return entry;
  };

  return async (request) => {
    const key = keyFor(new URL(request.url).pathname);
    if (key == null || (request.method !== "GET" && request.method !== "HEAD") || !acceptsJsonLd(request)) {
      return handler(request);
    }
    if (request.method === "HEAD") {
      const hit = await store.get(key).catch(() => undefined);
      return hit ? toResponse(hit, "HEAD") : handler(request);
    }
    const pending = inflight.get(key);
    if (pending) {
      const shared = await pending;
      return shared ? toResponse(shared, request.method) : handler(request);
    }
    // A response that wasn't cached has a body only its own caller can read.
    let uncached: Response | undefined;
    const loading = load(request, key)
      .then((result) => {
        if (result instanceof Response) {
          uncached = result;
          return null;
        }
        return result;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, loading);
    const entry = await loading;
    return entry ? toResponse(entry, request.method) : uncached!;
  };
}
