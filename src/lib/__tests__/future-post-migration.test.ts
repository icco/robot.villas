import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb("future post cleanup migration", () => {
  it("deletes future posts and their dependent rows while retaining past, present, and undated posts", async () => {
    const client = postgres(DATABASE_URL!);
    try {
      const migration = await readFile("drizzle/0022_delete_future_dated_posts.sql", "utf8");
      await client.begin(async (tx) => {
        await tx`CREATE TEMPORARY TABLE feed_entries (
          id integer PRIMARY KEY,
          published_at timestamptz
        ) ON COMMIT DROP`;
        await tx`CREATE TEMPORARY TABLE reactions (
          entry_id integer NOT NULL REFERENCES feed_entries(id)
        ) ON COMMIT DROP`;
        await tx`CREATE TEMPORARY TABLE publications (
          entry_id integer NOT NULL REFERENCES feed_entries(id)
        ) ON COMMIT DROP`;
        await tx`INSERT INTO feed_entries (id, published_at) VALUES
          (1, CURRENT_TIMESTAMP - INTERVAL '1 millisecond'),
          (2, CURRENT_TIMESTAMP),
          (3, NULL),
          (4, CURRENT_TIMESTAMP + INTERVAL '1 millisecond'),
          (5, CURRENT_TIMESTAMP + INTERVAL '1 year')`;
        await tx`INSERT INTO reactions (entry_id) VALUES (1), (2), (3), (4), (5)`;
        await tx`INSERT INTO publications (entry_id) VALUES (1), (2), (3), (4), (5)`;

        for (const statement of migration.split("--> statement-breakpoint")) {
          await tx.unsafe(statement);
        }

        expect(await tx`SELECT id FROM feed_entries ORDER BY id`).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
        expect(await tx`SELECT entry_id FROM reactions ORDER BY entry_id`)
          .toEqual([{ entry_id: 1 }, { entry_id: 2 }, { entry_id: 3 }]);
        expect(await tx`SELECT entry_id FROM publications ORDER BY entry_id`)
          .toEqual([{ entry_id: 1 }, { entry_id: 2 }, { entry_id: 3 }]);
      });
    } finally {
      await client.end();
    }
  });
});
