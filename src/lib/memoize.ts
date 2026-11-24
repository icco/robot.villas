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
