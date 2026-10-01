import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { createFederation } from "@fedify/testing";
import { Application, Delete, Follow, Like, Note, Undo } from "@fedify/vocab";
import { createDb, migrate, insertEntry, addFollower, getFollowers, upsertFollowing, getAllFollowing, upsertRelay, getAllRelays } from "../db";
import { receiveFollowResponse, receiveReaction, type ReactionInput } from "../inbox-state";
import { handleDelete, handleFollow, handleReaction, handleUndo, isPgIntegerId } from "../federation";
import * as schema from "../schema";

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("inbox authorization and idempotency", () => {
  const client = postgres(databaseUrl ?? "postgres://unused");
  const db = createDb(client);
  const bot = "security_test";
  const alice = new URL("https://remote.example/alice");
  const mallory = new URL("https://remote.example/mallory");
  const fed = createFederation<void>({ origin: "https://robot.test" });
  fed.setActorDispatcher("/users/{identifier}", async () => null);
  fed.setObjectDispatcher(Note, "/users/{identifier}/posts/{id}", async () => null);
  const ctx = fed.createContext(new URL("https://robot.test"), undefined);
  let reaction: ReactionInput;
  beforeAll(() => migrate(db));
  beforeEach(async () => {
    await db.delete(schema.reactions).where(eq(schema.reactions.actorId, alice.href));
    await db.delete(schema.feedEntries).where(eq(schema.feedEntries.botUsername, bot));
    await db.delete(schema.followers).where(eq(schema.followers.botUsername, bot));
    await db.delete(schema.following).where(eq(schema.following.botUsername, bot));
    await db.delete(schema.relays).where(eq(schema.relays.botUsername, bot));
    const id = await insertEntry(db, bot, "entry", "https://example.com", "test", new Date(), []);
    reaction = { activityId: `${alice}/likes/1`, actorId: alice.href, botUsername: bot, entryId: id!, kind: "like", content: "" };
    ctx.reset();
  });
  afterAll(() => client.end());
  const count = async () => (await db.select().from(schema.feedEntries).where(eq(schema.feedEntries.id, reaction.entryId)))[0].likeCount;

  it("authorizes Accept and Reject against both stored subscription targets", async () => {
    await upsertFollowing(db, bot, "alice@remote.example", alice.href, "https://robot.test/follow/1");
    await upsertRelay(db, bot, alice.href, `${alice}/inbox`, alice.href, "https://robot.test/follow/2");
    for (const status of ["accepted", "rejected"] as const) {
      await receiveFollowResponse(db, "https://robot.test/follow/1", mallory.href, status);
      await receiveFollowResponse(db, "https://robot.test/follow/2", mallory.href, status);
    }
    expect((await getAllFollowing(db)).find((f) => f.botUsername === bot)?.status).toBe("pending");
    expect((await getAllRelays(db)).find((f) => f.botUsername === bot)?.status).toBe("pending");
    await receiveFollowResponse(db, "https://robot.test/follow/1", alice.href, "accepted");
    await receiveFollowResponse(db, "https://robot.test/follow/2", alice.href, "rejected");
    expect((await getAllFollowing(db)).find((f) => f.botUsername === bot)?.status).toBe("accepted");
    expect((await getAllRelays(db)).find((f) => f.botUsername === bot)?.status).toBe("rejected");
  });

  it("changes a count once across concurrent duplicates and repeated Undo", async () => {
    await Promise.all([receiveReaction(db, reaction), receiveReaction(db, reaction)]);
    await receiveReaction(db, { ...reaction, activityId: `${alice}/likes/2` });
    expect(await count()).toBe(1);
    await Promise.all([receiveReaction(db, reaction, true), receiveReaction(db, reaction, true)]);
    await receiveReaction(db, reaction);
    expect(await count()).toBe(0);
  });

  it("records Undo before delivery and refuses forged Undo", async () => {
    await receiveReaction(db, reaction, true);
    await receiveReaction(db, reaction);
    expect(await count()).toBe(0);
    const second = { ...reaction, activityId: `${alice}/likes/2` };
    await receiveReaction(db, second);
    await handleUndo(ctx, new Undo({ actor: mallory, object: new Like({ id: new URL(second.activityId), actor: alice, object: ctx.getObjectUri(Note, { identifier: bot, id: String(reaction.entryId) }) }) }), db, [bot]);
    expect(await count()).toBe(1);
  });

  it("matches Undo Follow to the current Follow and distinguishes actor deletion", async () => {
    await addFollower(db, bot, alice.href, `${alice}/follow/new`);
    await handleUndo(ctx, new Undo({ actor: alice, object: new Follow({ id: new URL(`${alice}/follow/old`), actor: alice, object: ctx.getActorUri(bot) }) }), db, [bot]);
    await handleDelete(new Delete({ actor: alice, object: new URL(`${alice}/post`) }), db);
    expect(await getFollowers(db, bot)).toContain(alice.href);
    await handleDelete(new Delete({ actor: alice, object: alice }), db);
    expect(await getFollowers(db, bot)).not.toContain(alice.href);
  });

  it("ignores reactions to IDs outside PostgreSQL's integer range", async () => {
    expect(isPgIntegerId("2147483647")).toBe(true);
    expect(isPgIntegerId("2147483648")).toBe(false);
    expect(isPgIntegerId("9007199254740991")).toBe(false);
    await handleReaction(ctx, new Like({ id: new URL(`${alice}/likes/big`), actor: alice, object: ctx.getObjectUri(Note, { identifier: bot, id: "2147483648" }) }), db, [bot]);
    expect(await count()).toBe(0);
  });

  it("retries Follow with the same response identity and completes Undo", async () => {
    const actor = new Application({ id: alice, inbox: new URL(`${alice}/inbox`) });
    const follow = new Follow({ id: new URL(`${alice}/follow`), actor, object: ctx.getActorUri(bot) });
    await handleFollow(ctx, follow, db, [bot], new Set());
    await handleFollow(ctx, follow, db, [bot], new Set());
    const sends = ctx.getSentActivities();
    expect(sends[0].activity.id?.href).toBe(sends[1].activity.id?.href);
    expect(sends[0].activity.objectId?.href).toBe(follow.id?.href);
    await handleUndo(ctx, new Undo({ actor: alice, object: follow }), db, [bot]);
    expect(await getFollowers(db, bot)).toEqual([]);
  });
});
