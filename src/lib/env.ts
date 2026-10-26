/**
 * Parses a value as a positive integer, falling back to `fallback` when it's
 * missing, non-numeric, non-finite, or not positive, so a malformed env var
 * never becomes `NaN` downstream.
 */
export function parsePositiveInt(
  value: string | number | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = typeof value === "number" ? Math.trunc(value) : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
