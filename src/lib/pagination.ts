/**
 * Parses a `?page=` search param into a safe, non-negative page index.
 * Missing, non-numeric (e.g. "abc"), negative, or non-finite values all
 * fall back to 0 instead of producing NaN, which would otherwise reach
 * drizzle's `.offset()` as `OFFSET NaN` and fail at the database.
 */
export function parsePageParam(pageParam: string | undefined): number {
  const page = Number.parseInt(pageParam ?? "", 10);
  if (!Number.isFinite(page) || page < 0) {
    return 0;
  }
  return page;
}
