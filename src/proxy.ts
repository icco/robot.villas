import { fedifyWith, integrateFederation } from "@fedify/next";
import { NextResponse } from "next/server";
import { getGlobals } from "@/lib/globals";
import { isForeignAnnounce } from "@/lib/inbox-filter";
import { cacheResponses } from "@/lib/response-cache";

type Handler = (request: Request) => unknown;
let handlers: { federation: (request: Request) => Promise<Response>; direct: Handler } | null = null;

// fedifyWith() only handles requests with federation Accept headers or the
// well-known NodeInfo paths, but WebFinger and NodeInfo clients commonly send
// `Accept: */*` or `application/json`.
const DIRECT_PATHS = new Set(["/.well-known/webfinger", "/nodeinfo/2.1"]);

const POST_PATH = /^\/users\/([^/]+)\/posts\/\d+$/;
const ACTOR_PATH = /^\/users\/[^/]+$/;
// 98.5% of post fetches are for posts under two hours old, most within minutes of delivery.
const POST_CACHE_TTL_MS = 60 * 60 * 1000;
// Posts never change; tombstones aren't cached, so a shared cache shows a removed bot's tombstone at most this late.
const POST_CACHE_CONTROL = "public, max-age=300";
// Matches Mastodon's actor documents.
const ACTOR_CACHE_CONTROL = "public, max-age=180";

function getHandlers() {
  if (!handlers) {
    const { federation, config, responseStore } = getGlobals();
    const fedifyHandler = fedifyWith(federation)();
    const fedify = async (request: Request) => (await fedifyHandler(request)) as Response;
    handlers = {
      federation: cacheResponses(fedify, {
        store: responseStore,
        ttlMs: POST_CACHE_TTL_MS,
        cacheControl: POST_CACHE_CONTROL,
        keyFor: (pathname) => {
          const bot = POST_PATH.exec(pathname)?.[1];
          return bot && Object.hasOwn(config.bots, bot) ? pathname : null;
        },
      }),
      direct: integrateFederation(federation, () => undefined),
    };
  }
  return handlers;
}

export default async function proxy(request: Request) {
  const { pathname } = new URL(request.url);
  if (DIRECT_PATHS.has(pathname)) {
    return request.method === "GET" || request.method === "HEAD"
      ? getHandlers().direct(request)
      : NextResponse.next();
  }
  if (await isForeignAnnounce(request, `https://${getGlobals().domain}`)) {
    return new Response(null, { status: 202 });
  }
  const response = await getHandlers().federation(request);
  if (
    ACTOR_PATH.test(pathname) &&
    response.status === 200 &&
    response.headers.get("Content-Type")?.includes("application/activity+json")
  ) {
    response.headers.set("Cache-Control", ACTOR_CACHE_CONTROL);
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/:path*",
      has: [
        {
          type: "header",
          key: "Accept",
          value: ".*application\\/((jrd|activity|ld)\\+json|xrd\\+xml).*",
        },
      ],
    },
    {
      source: "/:path*",
      has: [
        {
          type: "header",
          key: "content-type",
          value: ".*application\\/((jrd|activity|ld)\\+json|xrd\\+xml).*",
        },
      ],
    },
    { source: "/.well-known/nodeinfo" },
    { source: "/.well-known/webfinger" },
    { source: "/.well-known/x-nodeinfo2" },
    { source: "/nodeinfo/2.1" },
  ],
};
