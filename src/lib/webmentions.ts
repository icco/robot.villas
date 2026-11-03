import { createHash } from "node:crypto";
import { createExponentialBackoffPolicy, type Context, type Federation, type KvStore, type TaskDefinition } from "@fedify/fedify";
import { Application, Hashtag, isActor, Service } from "@fedify/vocab";
import { Temporal as TemporalPolyfill } from "@js-temporal/polyfill";
import { getLogger } from "@logtape/logtape";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Parser } from "htmlparser2";
import LinkHeader from "http-link-header";
import { z } from "zod";
import type { Db } from "./db";
import { entryObjectUrl } from "./feed-entry";
import { fetchRemote, readTextPrefix } from "./remote-fetch";
import { feedEntries, reactions, remoteActors } from "./schema";
import { safeParseUrl } from "./urls";

const logger = getLogger(["robot-villas", "webmentions"]);

export const WEBMENTION_USER_AGENT = "robot.villas webmention/1.0 (+https://robot.villas/about)";
const MAX_DISCOVERY_BYTES = 1024 * 1024;
const PROFILE_MAX_AGE_MS = 7 * 86_400_000;

export type ExclusionReason = "automated" | "nobridge" | "nobot" | "undiscoverable";
export type RemoteActor = typeof remoteActors.$inferSelect;

export interface Discovery {
  endpoint: string;
  target: string;
}

export interface WebmentionDeps {
  db: Db;
  kv: KvStore;
  domain: string;
  botUsernames: string[];
}

function httpUrl(href: string, base: URL): URL | null {
  try {
    const url = new URL(href, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** https://www.w3.org/TR/webmention/#sender-discovers-receiver-webmention-endpoint */
export function findWebmentionEndpoint(linkHeader: string | null, html: string | null, pageUrl: URL): URL | null {
  if (linkHeader) {
    try {
      for (const ref of LinkHeader.parse(linkHeader).rel("webmention")) {
        const url = httpUrl(ref.uri, pageUrl);
        if (url) {
          return url;
        }
      }
    } catch (error) {
      logger.debug("Ignoring unparseable Link header on {url}: {error}", { url: pageUrl.href, error });
    }
  }
  if (!html) {
    return null;
  }
  let found: URL | null = null;
  const parser = new Parser({
    onopentag(name, attribs) {
      if (found || (name !== "link" && name !== "a") || attribs.href === undefined) {
        return;
      }
      if (attribs.rel?.toLowerCase().split(/\s+/).includes("webmention")) {
        found = httpUrl(attribs.href, pageUrl);
      }
    },
  });
  parser.write(html);
  parser.end();
  return found;
}

/** Tracking parameters would file the mention under a URL the site never shows. */
export function webmentionTarget(url: URL): URL {
  const target = new URL(url);
  target.hash = "";
  for (const key of [...target.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) {
      target.searchParams.delete(key);
    }
  }
  return target;
}

function htmlText(html: string): string {
  const parts: string[] = [];
  const parser = new Parser({ ontext: (text) => parts.push(text) });
  parser.write(html);
  parser.end();
  return parts.join("");
}

export function exclusionReason(profile: {
  automated: boolean;
  summary: string | null;
  discoverable: boolean | null;
  hashtags: string[];
}): ExclusionReason | null {
  if (profile.automated) {
    return "automated";
  }
  const text = `${htmlText(profile.summary ?? "")} ${profile.hashtags.join(" ")}`;
  if (/#nobridge(?![\p{L}\p{N}_])/iu.test(text)) {
    return "nobridge";
  }
  if (/#nobot(?![\p{L}\p{N}_])/iu.test(text)) {
    return "nobot";
  }
  return profile.discoverable === false ? "undiscoverable" : null;
}

export function reactionPageId(activityId: string): string {
  return createHash("sha256").update(activityId).digest("hex").slice(0, 32);
}

export function reactionPageUrl(domain: string, botUsername: string, entryId: number, pageId: string): string {
  return `${entryObjectUrl(domain, botUsername, entryId)}/reactions/${pageId}`;
}

function days(n: number): Temporal.Duration {
  return TemporalPolyfill.Duration.from({ days: n }) as unknown as Temporal.Duration;
}

/**
 * Cached per article for a day. A host whose article had no endpoint is skipped
 * for a week, so the thousands of feeds without webmention cost one fetch each.
 */
export async function discoverWebmentionEndpoint(kv: KvStore, articleUrl: string): Promise<Discovery | null> {
  const parsed = safeParseUrl(articleUrl);
  if (!parsed) {
    return null;
  }
  const requested = webmentionTarget(parsed);
  const cacheKey = ["webmention", "discovery", requested.href] as const;
  const cached = await kv.get<Discovery | { endpoint: null }>(cacheKey);
  if (cached) {
    return cached.endpoint ? cached as Discovery : null;
  }
  if (await kv.get(["webmention", "no-endpoint-host", requested.hostname])) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let found: Discovery | null;
  let pageUrl: URL;
  try {
    const response = await fetchRemote(requested, {
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", "User-Agent": WEBMENTION_USER_AGENT },
    });
    pageUrl = new URL(response.url || requested.href);
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      throw new Error(`Article ${requested.href} returned HTTP ${response.status}`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      await kv.set(cacheKey, { endpoint: null }, { ttl: days(1) });
      return null;
    }
    const html = /html/i.test(response.headers.get("content-type") ?? "")
      ? await readTextPrefix(response, MAX_DISCOVERY_BYTES)
      : null;
    if (html === null) {
      await response.body?.cancel();
    }
    const endpoint = findWebmentionEndpoint(response.headers.get("link"), html, pageUrl);
    found = endpoint ? { endpoint: endpoint.href, target: webmentionTarget(pageUrl).href } : null;
  } finally {
    clearTimeout(timeout);
  }
  await kv.set(cacheKey, found ?? { endpoint: null }, { ttl: days(1) });
  if (!found) {
    await kv.set(["webmention", "no-endpoint-host", pageUrl.hostname], true, { ttl: days(7) });
  }
  return found;
}

/** Throws on failures worth retrying; returns false when the receiver refused. */
export async function sendWebmention(endpoint: string, source: string, target: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchRemote(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": WEBMENTION_USER_AGENT },
      body: new URLSearchParams({ source, target }).toString(),
    });
    await response.body?.cancel();
    if (response.ok) {
      logger.info("Sent webmention {source} -> {target} (HTTP {status})", { source, target, status: response.status });
      return true;
    }
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      throw new Error(`Webmention endpoint ${endpoint} returned HTTP ${response.status}`);
    }
    logger.warn("Webmention endpoint {endpoint} refused {source} -> {target}: HTTP {status}", {
      endpoint, source, target, status: response.status,
    });
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetches with a bot's signature because many servers refuse unsigned profile requests. */
export async function loadRemoteActor(ctx: Context<void>, db: Db, actorId: string, signingBot: string): Promise<RemoteActor | null> {
  const [cached] = await db.select().from(remoteActors).where(eq(remoteActors.actorId, actorId));
  if (cached && Date.now() - cached.fetchedAt.getTime() < PROFILE_MAX_AGE_MS) {
    return cached;
  }
  const documentLoader = await ctx.getDocumentLoader({ identifier: signingBot });
  const actor = await ctx.lookupObject(actorId, { documentLoader });
  if (!isActor(actor) || actor.id?.href !== actorId) {
    return cached ?? null;
  }
  const hashtags: string[] = [];
  try {
    for await (const tag of actor.getTags({ documentLoader })) {
      if (tag instanceof Hashtag && tag.name) {
        hashtags.push(tag.name.toString());
      }
    }
  } catch (error) {
    logger.debug("Could not read tags for {actorId}: {error}", { actorId, error });
  }
  const icon = await actor.getIcon({ documentLoader }).catch(() => null);
  const iconLink = icon?.url;
  const profileLink = actor.url;
  const row: RemoteActor = {
    actorId,
    name: (actor.name ?? actor.preferredUsername ?? new URL(actorId).hostname).toString().slice(0, 200),
    profileUrl: safeParseUrl((profileLink instanceof URL ? profileLink : profileLink?.href)?.href)?.href ?? actorId,
    iconUrl: safeParseUrl((iconLink instanceof URL ? iconLink : iconLink?.href)?.href)?.href ?? null,
    excludedReason: exclusionReason({
      automated: actor instanceof Service || actor instanceof Application,
      summary: actor.summary?.toString() ?? null,
      discoverable: actor.discoverable,
      hashtags,
    }),
    fetchedAt: new Date(),
  };
  await db.insert(remoteActors).values(row).onConflictDoUpdate({ target: remoteActors.actorId, set: row });
  return row;
}

type EntryRow = typeof feedEntries.$inferSelect;

/** Records the discovered target before sending, because the receiver verifies the page links it. */
async function resolveTarget({ db, kv }: WebmentionDeps, entry: EntryRow): Promise<Discovery | null> {
  const found = await discoverWebmentionEndpoint(kv, entry.url);
  if (found && entry.webmentionTarget !== found.target) {
    await db.update(feedEntries).set({ webmentionTarget: found.target }).where(eq(feedEntries.id, entry.id));
  }
  return found;
}

export async function deliverPostWebmention(deps: WebmentionDeps, entryId: number): Promise<void> {
  const [entry] = await deps.db.select().from(feedEntries).where(and(eq(feedEntries.id, entryId), isNull(feedEntries.deletedAt)));
  if (!entry || !deps.botUsernames.includes(entry.botUsername)) {
    return;
  }
  const found = await resolveTarget(deps, entry);
  if (found) {
    await sendWebmention(found.endpoint, entryObjectUrl(deps.domain, entry.botUsername, entry.id), found.target);
  }
}

/** Also runs after an Undo: the reaction page then stops linking the article, which tells the receiver to delete it. */
export async function deliverReactionWebmention(ctx: Context<void>, deps: WebmentionDeps, activityId: string): Promise<void> {
  const [row] = await deps.db.select({ reaction: reactions, entry: feedEntries }).from(reactions)
    .innerJoin(feedEntries, eq(feedEntries.id, reactions.entryId))
    .where(eq(reactions.activityId, activityId));
  if (!row || row.reaction.kind === "emoji" || !row.reaction.pageId || row.entry.deletedAt || !deps.botUsernames.includes(row.entry.botUsername)) {
    return;
  }
  const actor = await loadRemoteActor(ctx, deps.db, row.reaction.actorId, row.entry.botUsername);
  if (!actor) {
    logger.info("Not forwarding {kind} by {actorId}: profile unavailable", { kind: row.reaction.kind, actorId: row.reaction.actorId });
    return;
  }
  if (actor.excludedReason) {
    logger[actor.excludedReason === "automated" ? "debug" : "info"]("Not forwarding {kind} by {actorId}: {reason}", {
      kind: row.reaction.kind, actorId: actor.actorId, reason: actor.excludedReason,
    });
    return;
  }
  const found = await resolveTarget(deps, row.entry);
  if (found) {
    await sendWebmention(found.endpoint, reactionPageUrl(deps.domain, row.entry.botUsername, row.entry.id, row.reaction.pageId), found.target);
  }
}

let tasks: {
  post: TaskDefinition<void, { entryId: number }>;
  reaction: TaskDefinition<void, { activityId: string }>;
} | undefined;

/** Must be called before `startQueue()`. */
export function defineWebmentionTasks(federation: Federation<void>, deps: WebmentionDeps): void {
  const retryPolicy = createExponentialBackoffPolicy({ maxAttempts: 5 });
  tasks = {
    post: federation.defineTask("webmention.post.v1", {
      schema: z.object({ entryId: z.number().int().positive() }),
      retryPolicy,
      handler: (_ctx, { entryId }) => deliverPostWebmention(deps, entryId),
      onError: (_ctx, error, data) => {
        logger.warn("Webmention for entry {entryId} failed: {error}", { entryId: data?.entryId, error });
      },
    }),
    reaction: federation.defineTask("webmention.reaction.v1", {
      schema: z.object({ activityId: z.string().url().max(2048) }),
      retryPolicy,
      handler: (ctx, { activityId }) => deliverReactionWebmention(ctx, deps, activityId),
      onError: (_ctx, error, data) => {
        logger.warn("Webmention for reaction {activityId} failed: {error}", { activityId: data?.activityId, error });
      },
    }),
  };
}

export async function enqueuePostWebmention(ctx: Context<void>, entryId: number): Promise<void> {
  if (tasks) {
    await ctx.enqueueTask(tasks.post, { entryId });
  }
}

export async function enqueueReactionWebmention(ctx: Context<void>, activityId: string): Promise<void> {
  if (tasks) {
    await ctx.enqueueTask(tasks.reaction, { activityId });
  }
}

export interface PostReaction {
  kind: "like" | "boost";
  name: string;
  profileUrl: string;
  iconUrl: string | null;
}

/** Named reactors only: excluded accounts and reactions from before profiles were cached still count in the totals. */
export async function getPostReactions(db: Db, entryId: number, limit = 200): Promise<PostReaction[]> {
  const rows = await db.select({
    kind: reactions.kind,
    name: remoteActors.name,
    profileUrl: remoteActors.profileUrl,
    iconUrl: remoteActors.iconUrl,
  }).from(reactions)
    .innerJoin(remoteActors, eq(remoteActors.actorId, reactions.actorId))
    .where(and(
      eq(reactions.entryId, entryId),
      isNull(reactions.undoneAt),
      isNull(remoteActors.excludedReason),
      inArray(reactions.kind, ["like", "boost"]),
    ))
    .orderBy(asc(reactions.createdAt))
    .limit(limit);
  return rows as PostReaction[];
}

export async function getReactionPage(db: Db, botUsername: string, entryId: number, pageId: string) {
  const [row] = await db.select({ reaction: reactions, entry: feedEntries, actor: remoteActors }).from(reactions)
    .innerJoin(feedEntries, eq(feedEntries.id, reactions.entryId))
    .innerJoin(remoteActors, eq(remoteActors.actorId, reactions.actorId))
    .where(and(
      eq(reactions.pageId, pageId),
      eq(reactions.entryId, entryId),
      eq(feedEntries.botUsername, botUsername),
      isNull(feedEntries.deletedAt),
      isNull(remoteActors.excludedReason),
      inArray(reactions.kind, ["like", "boost"]),
    ));
  return row ?? null;
}
