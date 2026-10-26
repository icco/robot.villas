/**
 * Parses a `?page=` search param into a non-negative page index with `parseInt`
 * semantics ("2abc" -> 2). Anything else invalid becomes 0, so OFFSET never sees NaN.
 */
export function parsePageParam(pageParam: string | undefined): number {
  const page = Number.parseInt(pageParam ?? "", 10);
  if (!Number.isFinite(page) || page < 0) {
    return 0;
  }
  return page;
}
