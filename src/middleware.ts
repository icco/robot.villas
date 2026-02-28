import { fedifyWith } from "@fedify/next";
import { getGlobals } from "@/lib/globals";

const { federation } = getGlobals();

export default fedifyWith(federation)();

export const config = {
  runtime: "nodejs",
  matcher: [
    {
      source: "/:path*",
      has: [
        {
          type: "header" as const,
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
          type: "header" as const,
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
