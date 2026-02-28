import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@fedify/fedify",
    "@fedify/next",
    "@fedify/postgres",
    "@fedify/vocab",
    "@fedify/vocab-runtime",
    "@fedify/vocab-tools",
    "@fedify/webfinger",
    "postgres",
    "drizzle-orm",
    "@logtape/logtape",
    "@js-temporal/polyfill",
    "rss-parser",
    "js-yaml",
    "escape-html",
    "zod",
  ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  experimental: {
    middlewareExternalPackages: [
      "@fedify/fedify",
      "@fedify/next",
      "@fedify/postgres",
      "@fedify/vocab",
      "@fedify/vocab-runtime",
      "@fedify/vocab-tools",
      "@fedify/webfinger",
      "postgres",
      "drizzle-orm",
      "@logtape/logtape",
      "@js-temporal/polyfill",
      "rss-parser",
      "js-yaml",
      "escape-html",
      "zod",
    ],
  } as NextConfig["experimental"],
};

export default nextConfig;
