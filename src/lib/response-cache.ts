import { getLogger } from "@logtape/logtape";
import type { Redis } from "ioredis";
import { LRUCache, type Perf } from "lru-cache";

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

const CACHEABLE_STATUSES = new Set([200, 410]);

/**
 * Serves ActivityPub GET and HEAD responses for paths `keyFor` names from
 * `store`, so one load answers every fetch of the same document until `ttlMs`
 * passes. Only 200 and 410 activity+json responses are kept, and a failing
 * store falls back to `handler`.
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
    if (!CACHEABLE_STATUSES.has(response.status) || !contentType.includes("application/activity+json")) {
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
    if (key == null || (request.method !== "GET" && request.method !== "HEAD")) {
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
