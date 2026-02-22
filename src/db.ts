import postgres from "postgres";

export type Sql = postgres.Sql;

export function createSql(databaseUrl: string): Sql {
  return postgres(databaseUrl);
}

export async function migrate(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS feed_entries (
      id            SERIAL PRIMARY KEY,
      bot_username  TEXT NOT NULL,
      guid          TEXT NOT NULL,
      url           TEXT NOT NULL,
      title         TEXT NOT NULL,
      published_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (bot_username, guid)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS actor_keypairs (
      bot_username  TEXT PRIMARY KEY,
      public_key    JSONB NOT NULL,
      private_key   JSONB NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS followers (
      id            SERIAL PRIMARY KEY,
      bot_username  TEXT NOT NULL,
      follower_id   TEXT NOT NULL,
      follow_id     TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (bot_username, follower_id)
    )
  `;
}

export async function hasEntry(sql: Sql, botUsername: string, guid: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM feed_entries WHERE bot_username = ${botUsername} AND guid = ${guid} LIMIT 1
  `;
  return rows.length > 0;
}

export async function insertEntry(
  sql: Sql,
  botUsername: string,
  guid: string,
  url: string,
  title: string,
  publishedAt: Date | null,
): Promise<void> {
  await sql`
    INSERT INTO feed_entries (bot_username, guid, url, title, published_at)
    VALUES (${botUsername}, ${guid}, ${url}, ${title}, ${publishedAt})
    ON CONFLICT (bot_username, guid) DO NOTHING
  `;
}

export async function getFollowers(sql: Sql, botUsername: string): Promise<string[]> {
  const rows = await sql`
    SELECT follower_id FROM followers WHERE bot_username = ${botUsername}
  `;
  return rows.map((r) => r.follower_id as string);
}

export async function addFollower(
  sql: Sql,
  botUsername: string,
  followerId: string,
  followId: string,
): Promise<void> {
  await sql`
    INSERT INTO followers (bot_username, follower_id, follow_id)
    VALUES (${botUsername}, ${followerId}, ${followId})
    ON CONFLICT (bot_username, follower_id) DO NOTHING
  `;
}

export async function removeFollower(sql: Sql, botUsername: string, followerId: string): Promise<void> {
  await sql`DELETE FROM followers WHERE bot_username = ${botUsername} AND follower_id = ${followerId}`;
}

export async function getKeypair(
  sql: Sql,
  botUsername: string,
): Promise<{ publicKey: JsonWebKey; privateKey: JsonWebKey } | null> {
  const rows = await sql`
    SELECT public_key, private_key FROM actor_keypairs WHERE bot_username = ${botUsername}
  `;
  if (rows.length === 0) return null;
  return {
    publicKey: rows[0].public_key as JsonWebKey,
    privateKey: rows[0].private_key as JsonWebKey,
  };
}

export async function saveKeypair(
  sql: Sql,
  botUsername: string,
  publicKey: JsonWebKey,
  privateKey: JsonWebKey,
): Promise<void> {
  await sql`
    INSERT INTO actor_keypairs (bot_username, public_key, private_key)
    VALUES (${botUsername}, ${sql.json(publicKey as unknown as postgres.JSONValue)}, ${sql.json(privateKey as unknown as postgres.JSONValue)})
    ON CONFLICT (bot_username) DO NOTHING
  `;
}
