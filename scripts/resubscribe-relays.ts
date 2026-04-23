/**
 * Resets relay subscriptions so they are re-attempted on the next restart.
 *
 * Usage:
 *   DATABASE_URL=... yarn tsx scripts/resubscribe-relays.ts [relay-url ...]
 *
 * With no arguments, resets ALL pending and rejected relay subscriptions.
 * Pass one or more relay URLs to target specific relays, e.g.:
 *   DATABASE_URL=... yarn tsx scripts/resubscribe-relays.ts \
 *     https://relay.toot.io/actor \
 *     https://relay.intahnet.co.uk/actor
 *
 * After running, restart the server — subscribeToRelays() will re-send
 * fresh Follow activities for every reset row.
 *
 * Note: if a relay previously sent a Reject (meaning it still has the old
 * subscription in its own DB), you may also need to contact the relay admin
 * to remove the stale subscription on their end, or send Undo(Follow) first.
 */

import postgres from "postgres";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { createDb } from "../src/lib/db";
import * as schema from "../src/lib/schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const targetUrls = process.argv.slice(2);

const client = postgres(databaseUrl);
const db = createDb(client);

const conditions = [
  isNull(schema.relays.deletedAt),
  or(eq(schema.relays.status, "pending"), eq(schema.relays.status, "rejected"))!,
];

if (targetUrls.length > 0) {
  conditions.push(inArray(schema.relays.url, targetUrls));
  console.log(`Resetting relay subscriptions for: ${targetUrls.join(", ")}`);
} else {
  console.log("Resetting ALL pending and rejected relay subscriptions...");
}

const rows = await db
  .select({
    botUsername: schema.relays.botUsername,
    url: schema.relays.url,
    status: schema.relays.status,
  })
  .from(schema.relays)
  .where(and(...conditions));

if (rows.length === 0) {
  console.log("No matching relay subscriptions found.");
  await client.end();
  process.exit(0);
}

console.log(`Found ${rows.length} row(s) to reset:`);
for (const row of rows) {
  console.log(`  ${row.botUsername} -> ${row.url} (${row.status})`);
}

await db
  .update(schema.relays)
  .set({ deletedAt: new Date() })
  .where(and(...conditions));

console.log(`Done. Restart the server to trigger fresh Follow activities.`);
await client.end();
