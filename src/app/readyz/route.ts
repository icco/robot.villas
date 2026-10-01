import { getGlobals } from "@/lib/globals";

export const dynamic = "force-dynamic";

const headers = { "Content-Type": "text/plain", "Cache-Control": "no-store" };

/** Readiness, unlike /healthcheck (liveness): fails while the database is unreachable. */
export async function GET() {
  const query = getGlobals().sql`SELECT 1`;
  // Cancel the query itself on timeout, so failed probes do not pile up in the pool.
  const timer = setTimeout(() => query.cancel(), 3_000);
  try {
    await query;
    return new Response("ready", { headers });
  } catch {
    return new Response("database unavailable", { status: 503, headers });
  } finally {
    clearTimeout(timer);
  }
}
