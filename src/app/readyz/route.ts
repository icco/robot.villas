import { sql } from "drizzle-orm";
import { getGlobals } from "@/lib/globals";

export const dynamic = "force-dynamic";

/** Readiness, unlike /healthcheck (liveness): fails while the database is unreachable. */
export async function GET() {
  try {
    await Promise.race([
      getGlobals().db.execute(sql`SELECT 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3_000)),
    ]);
    return new Response("ready", { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  } catch {
    return new Response("database unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  }
}
