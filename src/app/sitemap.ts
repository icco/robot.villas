import type { MetadataRoute } from "next";
import { getGlobals } from "@/lib/globals";

export default function sitemap(): MetadataRoute.Sitemap {
  const { config, domain } = getGlobals();
  const base = `https://${domain}`;

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1.0 },
    { url: `${base}/stats`, changeFrequency: "hourly", priority: 0.7 },
  ];

  const botPages: MetadataRoute.Sitemap = Object.keys(config.bots).map(
    (username) => ({
      url: `${base}/@${username}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    }),
  );

  return [...staticPages, ...botPages];
}
