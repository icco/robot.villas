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
  Announce,
  Application,
  Delete,
  EmojiReact,
  Endpoints,
  Follow,
  Image,
  Like,
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
  decrementBoostCount,
  decrementLikeCount,
  getAllFollowing,
  getAllRelays,
  getEntriesPage,
  getEntryById,
  getFollowerRecipients,
  getFollowers,
  getFollowingByActivityId,
  getKeypairs,
  incrementBoostCount,
  incrementLikeCount,
  removeFollower,
  removeFollowerFromAll,
  saveKeypairs,
  updateFollowingStatus,
  updateRelayStatus,
  upsertFollowing,
  upsertRelay,
  type Db,
} from "./db.js";
import { buildCreateActivity, formatContent, safeParseUrl } from "./publisher.js";

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

/**
 * Parses an activity's objectId into a bot identifier and entry ID,
 * returning null (with debug logging) if any step fails.
 */
function parseNoteRef(
  ctx: Context<void>,
  objectId: URL | null,
  botUsernames: string[],
  label: string,
): { identifier: string; entryId: number } | null {
  if (!objectId) {
    logger.debug("{label} ignored: missing objectId", { label });
    return null;
  }
  const parsed = ctx.parseUri(objectId);
  if (parsed?.type !== "object" || parsed.class !== Note) {
    logger.debug("{label} ignored: objectId {objectId} did not resolve to a Note", {
      label,
      objectId: objectId.href,
    });
    return null;
  }
  const { identifier, id } = parsed.values;
  if (!botUsernames.includes(identifier)) {
    logger.debug("{label} ignored: unknown bot {identifier}", { label, identifier });
    return null;
  }
  const entryId = parseInt(id, 10);
  if (Number.isNaN(entryId)) {
    logger.debug("{label} ignored: non-numeric entry id {id}", { label, id });
    return null;
  }
  return { identifier, entryId };
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
  const actorCallbacks = federation
    .setActorDispatcher(
      "/users/{identifier}",
      async (ctx, identifier) => {
        if (!botUsernames.includes(identifier)) return null;
        return buildActor(ctx, identifier, config.bots[identifier]);
      },
    )
    .mapHandle((_ctx, handle) => handle);

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
      const content = formatContent({ title: entry.title, link: entry.url, publishedAt: entry.publishedAt });
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

  // --- Follow object dispatcher (so Accept can dereference our outgoing follows) ---
  federation.setObjectDispatcher(
    Follow,
    "/users/{identifier}/follows/{id}",
    async (ctx, values) => {
      const { identifier } = values;
      if (!botUsernames.includes(identifier)) return null;
      const followUri = ctx.getObjectUri(Follow, values);
      const row = await getFollowingByActivityId(db, followUri.href);
      if (!row || !row.targetActorId) return null;
      return new Follow({
        id: followUri,
        actor: ctx.getActorUri(identifier),
        object: new URL(row.targetActorId),
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
  ).setCounter(async (_ctx, identifier) => {
    if (!botUsernames.includes(identifier)) return null;
    return await countFollowers(db, identifier);
  });

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
    .setSharedKeyDispatcher(() => ({ identifier: botUsernames[0] }))
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
      const sharedInbox = follower.endpoints?.sharedInbox?.href ?? follower.inboxId?.href ?? null;
      await addFollower(db, parsed.identifier, follower.id.href, follow.id.href, sharedInbox);
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
      if (object instanceof Follow) {
        if (!object.objectId || !undo.actorId) return;
        const parsed = ctx.parseUri(object.objectId);
        if (parsed?.type !== "actor" || !botUsernames.includes(parsed.identifier)) return;
        await removeFollower(db, parsed.identifier, undo.actorId.href);
      } else if (object instanceof Like || object instanceof EmojiReact) {
        const ref = parseNoteRef(ctx, object.objectId, botUsernames, "Undo Like");
        if (!ref) return;
        await decrementLikeCount(db, ref.identifier, ref.entryId);
        logger.info("Undo Like on {identifier}/posts/{entryId}", ref);
      } else if (object instanceof Announce) {
        const ref = parseNoteRef(ctx, object.objectId, botUsernames, "Undo Announce");
        if (!ref) return;
        await decrementBoostCount(db, ref.identifier, ref.entryId);
        logger.info("Undo Boost on {identifier}/posts/{entryId}", ref);
      }
    })
    .on(Accept, async (ctx, accept) => {
      const object = await accept.getObject(ctx);
      if (!(object instanceof Follow) || !object.id) return;
      const followIdHref = object.id.href;
      await updateRelayStatus(db, followIdHref, "accepted");
      await updateFollowingStatus(db, followIdHref, "accepted");
      logger.info("Accepted Follow {followId}", { followId: followIdHref });
    })
    .on(Announce, async (ctx, announce) => {
      const ref = parseNoteRef(ctx, announce.objectId, botUsernames, "Announce");
      if (!ref) return;
      await incrementBoostCount(db, ref.identifier, ref.entryId);
      logger.info("Boost on {identifier}/posts/{entryId}", ref);
    })
    .on(Like, async (ctx, like) => {
      const ref = parseNoteRef(ctx, like.objectId, botUsernames, "Like");
      if (!ref) return;
      await incrementLikeCount(db, ref.identifier, ref.entryId);
      logger.info("Like on {identifier}/posts/{entryId}", ref);
    })
    .on(EmojiReact, async (ctx, react) => {
      const ref = parseNoteRef(ctx, react.objectId, botUsernames, "EmojiReact");
      if (!ref) return;
      await incrementLikeCount(db, ref.identifier, ref.entryId);
      logger.info("EmojiReact on {identifier}/posts/{entryId}", ref);
    })
    .on(Delete, async (_ctx, del) => {
      if (!del.actorId) return;
      const removed = await removeFollowerFromAll(db, del.actorId.href);
      if (removed > 0) {
        logger.info("Removed deleted actor {actorId} from {count} bot(s)", {
          actorId: del.actorId.href,
          count: removed,
        });
      }
    })
    .onError((_ctx, error) => {
      logger.error("Inbox listener error: {error}", { error });
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
    const followerRows = await getFollowerRecipients(db, identifier);
    const recipients = followerRows
      .filter((f) => f.sharedInboxUrl)
      .map((f) => ({
        id: new URL(f.followerId),
        inboxId: new URL(f.sharedInboxUrl!),
        endpoints: null,
      }));
    if (recipients.length === 0) {
      logger.info("Skipping profile update for {identifier}: no followers with inbox", {
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

    await ctx.sendActivity({ identifier }, recipients, update);
    logger.info(
      "Sent profile Update for {identifier} to {count} follower(s)",
      { identifier, count: recipients.length },
    );
  }
}

/**
 * Sends a Follow activity from every bot to each account listed in
 * config.follows. Skips accounts that a bot has already followed.
 */
export async function followAccounts(
  ctx: Context<void>,
  db: Db,
  config: FeedsConfig,
): Promise<void> {
  const handles = config.follows ?? [];
  if (handles.length === 0) return;

  const botUsernames = Object.keys(config.bots);
  const existing = await getAllFollowing(db);
  const existingSet = new Set(existing.map((f) => `${f.botUsername}:${f.handle}`));

  const signingIdentifier = botUsernames[0];
  const documentLoader = await ctx.getDocumentLoader({
    identifier: signingIdentifier,
  });

  for (const rawHandle of handles) {
    const handle = rawHandle.replace(/^@/, "");

    let targetActor: Recipient;
    try {
      const resolved = await ctx.lookupObject(`acct:${handle}`, {
        documentLoader,
      });
      if (!resolved || !("id" in resolved) || !("inboxId" in resolved)) {
        logger.error(
          "Could not resolve actor for {handle}: lookup returned {type}",
          { handle, type: resolved?.constructor?.name ?? String(resolved) },
        );
        continue;
      }
      targetActor = resolved as Recipient;
      if (!targetActor.id || !targetActor.inboxId) {
        logger.error("Actor for {handle} has no id or inbox", { handle });
        continue;
      }
    } catch (error) {
      logger.error("Failed to look up {handle}: {error}", { handle, error });
      continue;
    }

    for (const botUsername of botUsernames) {
      if (existingSet.has(`${botUsername}:${handle}`)) {
        logger.info("Bot {bot} already follows {handle}, skipping", {
          bot: botUsername,
          handle,
        });
        continue;
      }

      try {
        const followId = new URL(
          `/users/${botUsername}/follows/${crypto.randomUUID()}`,
          ctx.getActorUri(botUsername),
        );

        const follow = new Follow({
          id: followId,
          actor: ctx.getActorUri(botUsername),
          object: targetActor.id,
        });

        await upsertFollowing(db, botUsername, handle, targetActor.id!.href, followId.href);
        await ctx.sendActivity({ identifier: botUsername }, targetActor, follow);

        logger.info("Sent Follow from {bot} to {handle}", {
          bot: botUsername,
          handle,
        });
      } catch (error) {
        logger.error("Failed to follow {handle} from {bot}: {error}", {
          handle,
          bot: botUsername,
          error,
        });
      }
    }
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
