import { LRUCache, type Perf } from "lru-cache";

/**
 * Caches the promise per key so concurrent callers share one load. A failed
 * load is dropped so the next call retries.
 */
export function memoizeAsync<K, V>(load: (key: K) => Promise<V>): (key: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  return (key) => {
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    const pending = load(key);
    cache.set(key, pending);
    pending.catch(() => {
      if (cache.get(key) === pending) {
        cache.delete(key);
      }
    });
    return pending;
  };
}

/**
 * Like memoizeAsync, but keeps at most `max` results for `ttlMs` each. Null
 * results and failures are not kept.
 */
export function memoizeAsyncFor<K extends string, V extends object | string | number | boolean>(
  load: (key: K) => Promise<V | null>,
  options: { ttlMs: number; max: number; perf?: Perf },
): (key: K) => Promise<V | null> {
  const cache = new LRUCache<K, V>({
    max: options.max,
    ttl: options.ttlMs,
    perf: options.perf,
    ...(options.perf && { ttlResolution: 0 }),
    fetchMethod: async (key) => (await load(key)) ?? undefined,
  });
  return async (key) => (await cache.fetch(key)) ?? null;
}
