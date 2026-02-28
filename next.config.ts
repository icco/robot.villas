import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@fedify/fedify",
    "@fedify/postgres",
    "@fedify/vocab",
    "postgres",
    "@logtape/logtape",
    "@js-temporal/polyfill",
    "rss-parser",
  ],
};

export default nextConfig;
