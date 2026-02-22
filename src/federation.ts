import {
  createFederation,
  exportJwk,
  generateCryptoKeyPair,
  importJwk,
  type Federation,
  type KvStore,
  type MessageQueue,
} from "@fedify/fedify";
import { Accept, Application, Follow, Undo } from "@fedify/vocab";
import type { FeedsConfig } from "./config.js";
import {
  addFollower,
  getFollowers,
  getKeypair,
  removeFollower,
  saveKeypair,
  type Db,
} from "./db.js";

export interface FederationDeps {
  config: FeedsConfig;
  db: Db;
  kvStore: KvStore;
  messageQueue: MessageQueue;
}

export function setupFederation(deps: FederationDeps): Federation<void> {
  const { config, db, kvStore, messageQueue } = deps;
  const botUsernames = Object.keys(config.bots);

  const fed = createFederation<void>({
    kv: kvStore,
    queue: messageQueue,
  });

  fed
    .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
      if (!botUsernames.includes(identifier)) return null;
      const bot = config.bots[identifier];
      return new Application({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        name: bot.display_name,
        summary: bot.summary,
        inbox: ctx.getInboxUri(identifier),
        outbox: ctx.getOutboxUri(identifier),
        url: new URL(`/users/${identifier}`, ctx.url),
        publicKeys: (await ctx.getActorKeyPairs(identifier)).map(
          (kp) => kp.cryptographicKey,
        ),
      });
    })
    .setKeyPairsDispatcher(async (_ctx, identifier) => {
      if (!botUsernames.includes(identifier)) return [];
      const existing = await getKeypair(db, identifier);
      if (existing) {
        const privateKey = await importJwk(existing.privateKey, "private");
        const publicKey = await importJwk(existing.publicKey, "public");
        return [{ privateKey, publicKey }];
      }
      const { privateKey, publicKey } =
        await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
      await saveKeypair(
        db,
        identifier,
        await exportJwk(publicKey),
        await exportJwk(privateKey),
      );
      return [{ privateKey, publicKey }];
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

  fed
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Follow, async (ctx, follow) => {
      if (!follow.id || !follow.actorId || !follow.objectId) return;
      const parsed = ctx.parseUri(follow.objectId);
      if (parsed?.type !== "actor" || !botUsernames.includes(parsed.identifier))
        return;
      const follower = await follow.getActor(ctx);
      if (!follower?.id) return;
      await addFollower(
        db,
        parsed.identifier,
        follower.id.href,
        follow.id.href,
      );
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
