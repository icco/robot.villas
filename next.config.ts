import type { NextConfig } from "next";

const REPORT_URI = "https://reportd.natwelch.com/report/robot-villas";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https: data:",
      "connect-src 'self' https://reportd.natwelch.com https://mastodon.social",
      "frame-ancestors 'none'",
      `report-uri ${REPORT_URI}`,
    ].join("; "),
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "NEL",
    value: JSON.stringify({
      report_to: "default",
      max_age: 2592000,
      include_subdomains: true,
    }),
  },
  {
    key: "Report-To",
    value: JSON.stringify({
      group: "default",
      max_age: 2592000,
      endpoints: [{ url: REPORT_URI }],
      include_subdomains: true,
    }),
  },
  {
    key: "Reporting-Endpoints",
    value: `default="${REPORT_URI}"`,
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
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
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
