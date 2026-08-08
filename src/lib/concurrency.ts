/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once,
 * preserving input order in the returned array. Used to bound how many
 * feeds/requests run concurrently without waiting for a fully sequential
 * loop or firing everything at once.
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
  // Guard against a non-finite/non-positive limit (e.g. NaN from a bad env
  // var) collapsing Array.from({length}) to zero workers, which would
  // silently skip every item instead of falling back to sequential.
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
