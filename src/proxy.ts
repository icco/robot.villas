import { fedifyWith } from "@fedify/next";
import { getGlobals } from "@/lib/globals";

let handler: ((request: Request) => unknown) | null = null;

function getHandler(): (request: Request) => unknown {
  if (!handler) {
    const { federation } = getGlobals();
    handler = fedifyWith(federation)();
  }
  return handler;
}

export default function proxy(request: Request) {
  return getHandler()(request);
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
    { source: "/.well-known/x-nodeinfo2" },
  ],
};
