/**
 * Soft-deletes relay rows so the next deployment with a new build or feeds.yml
 * follows them again.
 * Only the designated relay bot (`relay_subscription_bot` in feeds.yml, or
 * the first bot) is updated — the same as subscribeToRelays() at runtime.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/resubscribe-relays.ts [relay-url ...]
 *
 * With no arguments, resets pending and rejected relay rows for that bot.
 * Pass one or more relay URLs to target specific relays, e.g.:
 *   DATABASE_URL=... pnpm tsx scripts/resubscribe-relays.ts https://relay.example/actor
 *
 * Rejected rows retry on their own after RELAY_REJECT_RETRY_MS; this retries
 * sooner once the cause is fixed.
 */

import postgres from "postgres";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { getRelaySubscriptionBot, loadConfig } from "../src/lib/config";
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

const config = loadConfig("feeds.yml");
const designated = getRelaySubscriptionBot(config);
console.log(`Using relay subscription bot: ${designated} (set relay_subscription_bot in feeds.yml to override).`);

const conditions = [
  isNull(schema.relays.deletedAt),
  eq(schema.relays.botUsername, designated),
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

console.log(`Done. The next deployment with a new build or feeds.yml sends fresh Follow activities.`);
await client.end();
