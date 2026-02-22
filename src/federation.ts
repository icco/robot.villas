import {
  createFederation,
  exportJwk,
  generateCryptoKeyPair,
  importJwk,
  type Federation,
  type KvStore,
  type MessageQueue,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import { Accept, Application, Endpoints, Follow, Image, Reject, Undo } from "@fedify/vocab";
import type { FeedsConfig } from "./config.js";
import {
  addFollower,
  countEntries,
  getEntriesPage,
  getFollowers,
  getKeypairs,
  removeFollower,
  saveKeypairs,
  type Db,
} from "./db.js";
import { buildCreateActivity } from "./publisher.js";

export interface FederationDeps {
  config: FeedsConfig;
  db: Db;
  kvStore: KvStore;
  messageQueue: MessageQueue;
  /** Blocked instance hostnames (lowercase); Follow from these gets Reject. */
  blockedInstances?: Set<string>;
}

const logger = getLogger(["robot-villas", "federation"]);

export function setupFederation(deps: FederationDeps): Federation<void> {
  const { config, db, kvStore, messageQueue, blockedInstances = new Set() } = deps;
  const botUsernames = Object.keys(config.bots);

  const fed = createFederation<void>({
    kv: kvStore,
    queue: messageQueue,
    manuallyStartQueue: true,
  });

  fed
    .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
      if (!botUsernames.includes(identifier)) return null;
      const bot = config.bots[identifier];
      const keys = await ctx.getActorKeyPairs(identifier);
      return new Application({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        name: bot.display_name,
        summary: bot.summary,
        icon: bot.profile_photo
          ? new Image({ url: new URL(bot.profile_photo) })
          : null,
        inbox: ctx.getInboxUri(identifier),
        outbox: ctx.getOutboxUri(identifier),
        followers: ctx.getFollowersUri(identifier),
        endpoints: new Endpoints({
          sharedInbox: ctx.getInboxUri(),
        }),
        url: new URL(`/@${identifier}`, ctx.url),
        publicKeys: keys.map((kp) => kp.cryptographicKey),
        assertionMethods: keys.map((kp) => kp.multikey),
      });
    })
    .setKeyPairsDispatcher(async (_ctx, identifier) => {
      if (!botUsernames.includes(identifier)) return [];
      const existing = await getKeypairs(db, identifier);
      if (existing && existing.length >= 2) {
        return await Promise.all(
          existing.map(async (kp) => ({
            privateKey: await importJwk(kp.privateKey, "private"),
            publicKey: await importJwk(kp.publicKey, "public"),
          })),
        );
      }
      // Reuse existing RSA key pair if present, otherwise generate fresh
      const rsaPair = existing?.[0]
        ? {
            privateKey: await importJwk(existing[0].privateKey, "private"),
            publicKey: await importJwk(existing[0].publicKey, "public"),
          }
        : await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
      const ed25519Pair = await generateCryptoKeyPair("Ed25519");
      await saveKeypairs(db, identifier, [
        {
          publicKey: await exportJwk(rsaPair.publicKey),
          privateKey: await exportJwk(rsaPair.privateKey),
        },
        {
          publicKey: await exportJwk(ed25519Pair.publicKey),
          privateKey: await exportJwk(ed25519Pair.privateKey),
        },
      ]);
      return [rsaPair, ed25519Pair];
    });

  const OUTBOX_PAGE_SIZE = 20;

  fed
    .setOutboxDispatcher(
      "/users/{identifier}/outbox",
      async (ctx, identifier, cursor) => {
        if (!botUsernames.includes(identifier)) return null;
        const offset = cursor ? parseInt(cursor, 10) : 0;
        const entries = await getEntriesPage(
          db,
          identifier,
          OUTBOX_PAGE_SIZE,
          offset,
        );
        const total = await countEntries(db, identifier);
        const nextOffset = offset + entries.length;
        return {
          items: entries.map((e) =>
            buildCreateActivity(
              identifier,
              e.id,
              { title: e.title, link: e.url, publishedAt: e.publishedAt },
              ctx.url,
            ),
          ),
          prevCursor: offset > 0 ? String(Math.max(0, offset - OUTBOX_PAGE_SIZE)) : null,
          nextCursor: nextOffset < total ? String(nextOffset) : null,
        };
      },
    )
    .setCounter(async (_ctx, identifier) => {
      if (!botUsernames.includes(identifier)) return null;
      return await countEntries(db, identifier);
    })
    .setFirstCursor(async (_ctx, identifier) => {
      if (!botUsernames.includes(identifier)) return null;
      return "0";
    })
    .setLastCursor(async (_ctx, identifier) => {
      if (!botUsernames.includes(identifier)) return null;
      const total = await countEntries(db, identifier);
      if (total === 0) return null;
      const lastOffset =
        Math.floor((total - 1) / OUTBOX_PAGE_SIZE) * OUTBOX_PAGE_SIZE;
      return String(lastOffset);
    });

  fed.setFollowersDispatcher(
    "/users/{identifier}/followers",
    async (_ctx, identifier) => {
      if (!botUsernames.includes(identifier)) return null;
      const followerIds = await getFollowers(db, identifier);
      return {
        items: followerIds.map((id) => ({
          id: new URL(id),
          inboxId: null,
          endpoints: null,
        })),
      };
    },
  );

  fed.setNodeInfoDispatcher("/nodeinfo/2.1", async () => {
    let localPosts = 0;
    for (const identifier of botUsernames) {
      localPosts += await countEntries(db, identifier);
    }
    return {
      software: { name: "robot-villas", version: "1.0.0" },
      protocols: ["activitypub"],
      usage: {
        users: { total: botUsernames.length },
        localPosts,
        localComments: 0,
      },
    };
  });

  fed
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Follow, async (ctx, follow) => {
      if (!follow.id || !follow.actorId || !follow.objectId) {
        logger.warn("Follow ignored: missing id, actorId, or objectId");
        return;
      }
      const parsed = ctx.parseUri(follow.objectId);
      if (parsed?.type !== "actor" || !botUsernames.includes(parsed.identifier)) {
        logger.warn("Follow ignored: {objectId} is not a known bot", { objectId: follow.objectId });
        return;
      }
      const follower = await follow.getActor(ctx);
      if (!follower?.id) {
        logger.error("Failed to resolve actor {actorId}", { actorId: follow.actorId });
        return;
      }
      const followerHost = follower.id.hostname.toLowerCase();
      if (blockedInstances.has(followerHost)) {
        logger.info("Rejected follow from blocked instance {host}", { host: followerHost });
        await ctx.sendActivity(
          { identifier: parsed.identifier },
          follower,
          new Reject({ actor: follow.objectId, object: follow }),
        );
        return;
      }
      await addFollower(
        db,
        parsed.identifier,
        follower.id.href,
        follow.id.href,
      );
      logger.info("Accepting follow {followerId} -> {identifier}", { followerId: follower.id.href, identifier: parsed.identifier });
      await ctx.sendActivity(
        { identifier: parsed.identifier },
        follower,
        new Accept({ actor: follow.objectId, object: follow }),
      );
    })
    .on(Undo, async (ctx, undo) => {
      const object = await undo.getObject(ctx);
      if (!(object instanceof Follow)) return;
      if (!object.objectId || !undo.actorId) return;
      const parsed = ctx.parseUri(object.objectId);
      if (parsed?.type !== "actor" || !botUsernames.includes(parsed.identifier))
        return;
      await removeFollower(db, parsed.identifier, undo.actorId.href);
    });

  return fed;
}
