import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const { fedifyWith } = await import("@fedify/next");
  const { getGlobals } = await import("@/lib/globals");
  const { federation } = getGlobals();
  const handler = fedifyWith(federation)();
  return handler(request);
}

export const config = {
  runtime: "nodejs",
  matcher: [
    {
      source: "/:path*",
      has: [
        {
          type: "header",
          key: "Accept",
          value:
            ".*application\\/((jrd|activity|ld)\\+json|xrd\\+xml).*",
        },
      ],
    },
    {
      source: "/:path*",
      has: [
        {
          type: "header",
          key: "content-type",
          value:
            ".*application\\/((jrd|activity|ld)\\+json|xrd\\+xml).*",
        },
      ],
    },
    { source: "/.well-known/nodeinfo" },
    { source: "/.well-known/x-nodeinfo2" },
  ],
};
