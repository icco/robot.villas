import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  serverExternalPackages: [
    "rss-parser",
    "postgres",
  ],
  async rewrites() {
    return [
      {
        source: "/@:username",
        destination: "/bot/:username",
      },
    ];
  },
};

export default nextConfig;
