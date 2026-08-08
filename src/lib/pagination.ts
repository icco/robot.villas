/**
 * Parses a `?page=` search param into a safe, non-negative page index.
 * Uses `parseInt` semantics: a leading integer is read out of the string
 * (so "2abc" -> 2) and fractional values truncate ("2.9" -> 2). Missing,
 * entirely non-numeric (e.g. "abc"), negative, or non-finite values fall
 * back to 0 instead of producing NaN, which would otherwise reach
 * drizzle's `.offset()` as `OFFSET NaN` and fail at the database.
 */
export function parsePageParam(pageParam: string | undefined): number {
  const page = Number.parseInt(pageParam ?? "", 10);
  if (!Number.isFinite(page) || page < 0) {
    return 0;
  }
  return page;
}
