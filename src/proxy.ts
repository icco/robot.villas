import { fedifyWith, integrateFederation } from "@fedify/next";
import { NextResponse } from "next/server";
import { getGlobals } from "@/lib/globals";
import { isForeignAnnounce } from "@/lib/inbox-filter";

type Handler = (request: Request) => unknown;
let handlers: { federation: Handler; direct: Handler } | null = null;

// fedifyWith() only handles requests with federation Accept headers or the
// well-known NodeInfo paths, but WebFinger and NodeInfo clients commonly send
// `Accept: */*` or `application/json`.
const DIRECT_PATHS = new Set(["/.well-known/webfinger", "/nodeinfo/2.1"]);

function getHandlers() {
  if (!handlers) {
    const { federation } = getGlobals();
    handlers = {
      federation: fedifyWith(federation)(),
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
  return getHandlers().federation(request);
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
