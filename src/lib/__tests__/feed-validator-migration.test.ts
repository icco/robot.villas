import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb("feed validator reset migration", () => {
  it("clears existing validators without changing feed status or retry deadlines", async () => {
    const client = postgres(DATABASE_URL!);
    try {
      const migration = await readFile("drizzle/0023_reset_feed_validators.sql", "utf8");
      await client.begin(async (tx) => {
        await tx`CREATE TEMPORARY TABLE feed_poll_status (
          bot_username text PRIMARY KEY,
          etag text,
          last_modified text,
          last_http_status integer,
          next_poll_at timestamptz
        ) ON COMMIT DROP`;
        await tx`INSERT INTO feed_poll_status VALUES
          ('alice', '"cached"', 'yesterday', 200, NULL),
          ('bob', NULL, 'today', 429, '2026-10-12T00:00:00Z'),
          ('ada', NULL, NULL, 500, NULL)`;
        const before = await tx`SELECT bot_username, last_http_status, next_poll_at FROM feed_poll_status ORDER BY bot_username`;

        for (const statement of migration.split("--> statement-breakpoint")) {
          await tx.unsafe(statement);
        }

        expect(await tx`SELECT bot_username, etag, last_modified FROM feed_poll_status ORDER BY bot_username`).toEqual([
          { bot_username: "ada", etag: null, last_modified: null },
          { bot_username: "alice", etag: null, last_modified: null },
          { bot_username: "bob", etag: null, last_modified: null },
        ]);
        expect(await tx`SELECT bot_username, last_http_status, next_poll_at FROM feed_poll_status ORDER BY bot_username`).toEqual(before);
      });
    } finally {
      await client.end();
    }
  });
});
