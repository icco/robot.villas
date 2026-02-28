import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  serverExternalPackages: [
    "@fedify/fedify",
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
};

export default nextConfig;
