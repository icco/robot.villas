import {
  createFederation,
  exportJwk,
  generateCryptoKeyPair,
  importJwk,
  type Context,
  type Federation,
  type KvStore,
  type MessageQueue,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import { Temporal } from "@js-temporal/polyfill";
import {
  Accept,
  Application,
  Endpoints,
  Follow,
  Image,
  Note,
  PUBLIC_COLLECTION,
  type Recipient,
  Reject,
  Undo,
  Update,
} from "@fedify/vocab";
import escapeHtml from "escape-html";
import type { BotConfig, FeedsConfig } from "./config.js";
import {
  addFollower,
  countEntries,
  countFollowers,
  getAllRelays,
  getEntriesPage,
  getEntryById,
  getFollowers,
  getKeypairs,
  removeFollower,
  saveKeypairs,
  updateRelayStatus,
  upsertRelay,
  type Db,
} from "./db.js";
import { buildCreateActivity, safeParseUrl } from "./publisher.js";

export interface FederationDeps {
  config: FeedsConfig;
  db: Db;
  kvStore: KvStore;
  messageQueue: MessageQueue;
  blockedInstances?: Set<string>;
}

const logger = getLogger(["robot-villas", "federation"]);

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

function buildIcon(photoUrl: string): Image {
  const url = new URL(photoUrl);
  const ext = url.pathname.match(/\.[a-z]+$/i)?.[0]?.toLowerCase() ?? "";
  const mediaType = IMAGE_MEDIA_TYPES[ext];
  return new Image({
    url,
    ...(mediaType ? { mediaType } : {}),
  });
}

async function buildActor(
  ctx: Context<void>,
  identifier: string,
  bot: BotConfig,
): Promise<Application> {
  const keys = await ctx.getActorKeyPairs(identifier);
  const actorUri = ctx.getActorUri(identifier);
  const enrichedSummary =
    `<p>${escapeHtml(bot.summary)}</p>` +
    `<p>I am a bot that mirrors an RSS feed. ` +
    `Source: <a href="${escapeHtml(bot.feed_url)}">${escapeHtml(bot.feed_url)}</a></p>`;
  return new Application({
    id: actorUri,
    preferredUsername: identifier,
    name: bot.display_name,
    summary: enrichedSummary,
    icon: bot.profile_photo ? buildIcon(bot.profile_photo) : null,
    inbox: ctx.getInboxUri(identifier),
    outbox: ctx.getOutboxUri(identifier),
    followers: ctx.getFollowersUri(identifier),
    endpoints: new Endpoints({
      sharedInbox: ctx.getInboxUri(),
    }),
    url: new URL(`/@${identifier}`, actorUri),
    publicKey: keys[0]?.cryptographicKey,
    assertionMethods: keys.map((k) => k.multikey),
  });
}

export function setupFederation(deps: FederationDeps): Federation<void> {
  const { config, db, kvStore, messageQueue, blockedInstances = new Set() } = deps;
  const botUsernames = Object.keys(config.bots);

  const federation = createFederation<void>({
    kv: kvStore,
    queue: messageQueue,
    manuallyStartQueue: true,
  });

  // --- Actor dispatcher (following the Fedify microblog tutorial pattern) ---
  const actorCallbacks = federation.setActorDispatcher(
    "/users/{identifier}",
    async (ctx, identifier) => {
      if (!botUsernames.includes(identifier)) return null;
      return buildActor(ctx, identifier, config.bots[identifier]);
    },
  );

  // Key pairs dispatcher — must be registered via the setters returned above
  actorCallbacks.setKeyPairsDispatcher(async (_ctx, identifier) => {
    if (!botUsernames.includes(identifier)) return [];
    try {
      const existing = await getKeypairs(db, identifier);
      if (existing && existing.length >= 2) {
        logger.info("Loaded {count} existing key pairs for {identifier}", {
          count: existing.length,
          identifier,
        });
        return await Promise.all(
          existing.map(async (kp) => ({
            privateKey: await importJwk(kp.privateKey, "private"),
            publicKey: await importJwk(kp.publicKey, "public"),
          })),
        );
      }
      logger.info("Generating key pairs for {identifier} (existing: {existing})", {
        identifier,
        existing: existing?.length ?? 0,
      });
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
      logger.info("Saved new key pairs for {identifier}", { identifier });
      return [rsaPair, ed25519Pair];
    } catch (error) {
      logger.error("Key pairs dispatcher failed for {identifier}: {error}", {
        identifier,
        error,
      });
      throw error;
    }
  });

  // --- Outbox dispatcher ---
  const OUTBOX_PAGE_SIZE = 20;

  federation
    .setOutboxDispatcher(
      "/users/{identifier}/outbox",
      async (ctx, identifier, cursor) => {
        if (!botUsernames.includes(identifier)) return null;
        const offset = cursor ? parseInt(cursor, 10) : 0;
        const entries = await getEntriesPage(db, identifier, OUTBOX_PAGE_SIZE, offset);
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

  // --- Note object dispatcher ---
  federation.setObjectDispatcher(
    Note,
    "/users/{identifier}/posts/{id}",
    async (ctx, values) => {
      const { identifier, id } = values;
      if (!botUsernames.includes(identifier)) return null;
      const entryId = parseInt(id, 10);
      if (Number.isNaN(entryId)) return null;
      const entry = await getEntryById(db, identifier, entryId);
      if (!entry) return null;
      const content =
        `<p>${escapeHtml(entry.title)}</p>` +
        (entry.url ? `<p><a href="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</a></p>` : "");
      return new Note({
        id: ctx.getObjectUri(Note, values),
        attribution: ctx.getActorUri(identifier),
        to: PUBLIC_COLLECTION,
        cc: ctx.getFollowersUri(identifier),
        content,
        mediaType: "text/html",
        url: safeParseUrl(entry.url),
        published: entry.publishedAt
          ? Temporal.Instant.from(entry.publishedAt.toISOString())
          : undefined,
      });
    },
  );

  // --- Followers collection dispatcher ---
  federation.setFollowersDispatcher(
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

  // --- NodeInfo dispatcher ---
  federation.setNodeInfoDispatcher("/nodeinfo/2.1", async () => {
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

  // --- Inbox listeners ---
  federation
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Follow, async (ctx, follow) => {
      if (!follow.id || !follow.actorId || !follow.objectId) {
        logger.warn("Follow ignored: missing id, actorId, or objectId");
        return;
      }
      const parsed = ctx.parseUri(follow.objectId);
      if (parsed?.type !== "actor" || !botUsernames.includes(parsed.identifier)) {
        logger.warn("Follow ignored: {objectId} is not a known bot", {
          objectId: follow.objectId,
        });
        return;
      }
      const follower = await follow.getActor(ctx);
      if (!follower?.id) {
        logger.error("Failed to resolve actor {actorId}", {
          actorId: follow.actorId,
        });
        return;
      }
      const followerHost = follower.id.hostname.toLowerCase();
      if (blockedInstances.has(followerHost)) {
        logger.info("Rejected follow from blocked instance {host}", {
          host: followerHost,
        });
        await ctx.sendActivity(
          { identifier: parsed.identifier },
          follower,
          new Reject({ actor: follow.objectId, object: follow }),
        );
        return;
      }
      await addFollower(db, parsed.identifier, follower.id.href, follow.id.href);
      logger.info("Accepting follow {followerId} -> {identifier}", {
        followerId: follower.id.href,
        identifier: parsed.identifier,
      });
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
      if (parsed?.type !== "actor" || !botUsernames.includes(parsed.identifier)) return;
      await removeFollower(db, parsed.identifier, undo.actorId.href);
    })
    .on(Accept, async (_ctx, accept) => {
      const object = await accept.getObject();
      if (!(object instanceof Follow) || !object.id) return;
      await updateRelayStatus(db, object.id.href, "accepted");
      logger.info("Relay accepted our Follow {followId}", {
        followId: object.id.href,
      });
    });

  return federation;
}

/**
 * Sends an Update(Application) activity for each bot to all its followers,
 * causing remote servers to refresh their cached copy of the actor profile.
 */
export async function sendProfileUpdates(
  ctx: Context<void>,
  db: Db,
  config: FeedsConfig,
): Promise<void> {
  for (const identifier of Object.keys(config.bots)) {
    const followerCount = await countFollowers(db, identifier);
    if (followerCount === 0) {
      logger.info("Skipping profile update for {identifier}: no followers", {
        identifier,
      });
      continue;
    }

    const bot = config.bots[identifier];
    const actor = await buildActor(ctx, identifier, bot);

    const update = new Update({
      id: new URL(
        `/users/${identifier}#profile-update-${Date.now()}`,
        ctx.getActorUri(identifier),
      ),
      actor: ctx.getActorUri(identifier),
      object: actor,
    });

    await ctx.sendActivity({ identifier }, "followers", update);
    logger.info(
      "Sent profile Update for {identifier} to {count} follower(s)",
      { identifier, count: followerCount },
    );
  }
}

/**
 * Subscribes to configured relays by sending Follow activities from the first
 * bot actor. Skips relays that already have a pending or accepted subscription.
 */
export async function subscribeToRelays(
  ctx: Context<void>,
  db: Db,
  config: FeedsConfig,
): Promise<void> {
  const relayUrls = config.relays ?? [];
  if (relayUrls.length === 0) return;

  const subscriberBot = Object.keys(config.bots)[0];
  if (!subscriberBot) return;

  const existingRelays = await getAllRelays(db);
  const existingUrls = new Set(existingRelays.map((r) => r.url));

  for (const relayUrl of relayUrls) {
    if (existingUrls.has(relayUrl)) {
      logger.info("Relay {url} already tracked, skipping subscription", {
        url: relayUrl,
      });
      continue;
    }

    try {
      const relayActor = await ctx.lookupObject(relayUrl);
      if (!relayActor || !("inboxId" in relayActor)) {
        logger.error("Could not resolve relay actor at {url}", { url: relayUrl });
        continue;
      }
      const recipient = relayActor as Recipient;
      if (!recipient.id || !recipient.inboxId) {
        logger.error("Relay actor at {url} has no id or inbox", { url: relayUrl });
        continue;
      }

      const followId = new URL(
        `/relay-follows/${crypto.randomUUID()}`,
        ctx.getActorUri(subscriberBot),
      );

      const follow = new Follow({
        id: followId,
        actor: ctx.getActorUri(subscriberBot),
        object: recipient.id,
      });

      await upsertRelay(
        db,
        relayUrl,
        recipient.inboxId.href,
        recipient.id.href,
        followId.href,
      );

      await ctx.sendActivity(
        { identifier: subscriberBot },
        recipient,
        follow,
      );

      logger.info(
        "Sent Follow to relay {url} (actor: {actorId}) from {bot}",
        { url: relayUrl, actorId: recipient.id!.href, bot: subscriberBot },
      );
    } catch (error) {
      logger.error("Failed to subscribe to relay {url}: {error}", {
        url: relayUrl,
        error,
      });
    }
  }
}
