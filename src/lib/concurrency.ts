/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once,
 * preserving input order in the returned array.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) {
    return results;
  }
  let nextIndex = 0;
  // NaN survives Math.min/max and would start zero workers, skipping every item.
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 1;
  const workerCount = Math.max(1, Math.min(safeLimit, items.length));

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
