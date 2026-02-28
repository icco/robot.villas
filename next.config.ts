import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  serverExternalPackages: [
    "rss-parser",
    "postgres",
  ],
};

export default nextConfig;
