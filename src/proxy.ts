import { fedifyWith, integrateFederation } from "@fedify/next";
import { NextResponse } from "next/server";
import { getGlobals } from "@/lib/globals";

type Handler = (request: Request) => unknown;
let handlers: { federation: Handler; webfinger: Handler } | null = null;

function getHandlers() {
  if (!handlers) {
    const { federation } = getGlobals();
    handlers = {
      federation: fedifyWith(federation)(),
      // fedifyWith() only handles requests with federation Accept headers, but
      // WebFinger clients commonly send `Accept: */*`.
      webfinger: integrateFederation(federation, () => undefined),
    };
  }
  return handlers;
}

export default function proxy(request: Request) {
  const { pathname } = new URL(request.url);
  if (pathname === "/.well-known/webfinger") {
    return request.method === "GET" || request.method === "HEAD"
      ? getHandlers().webfinger(request)
      : NextResponse.next();
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
