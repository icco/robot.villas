import { ImageResponse } from "next/og";
import { getGlobals } from "@/lib/globals";
import { getGlobalStats } from "@/lib/db";
import { OgChipIcon } from "@/lib/og-icon";

export const dynamic = "force-dynamic";
export const alt = "Stats";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage() {
  const { config, domain, db } = getGlobals();
  const botCount = Object.keys(config.bots).length;
  const global = await getGlobalStats(db);
  const fmt = (n: number) => n.toLocaleString("en-US");

  const stats = [
    { label: "Bots", value: fmt(botCount) },
    { label: "Posts", value: fmt(global.totalPosts) },
    { label: "Followers", value: fmt(global.totalFollowers) },
    { label: "Likes", value: fmt(global.totalLikes) },
    { label: "Boosts", value: fmt(global.totalBoosts) },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #1a1d2e 0%, #2a2e3f 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          fontFamily: "sans-serif",
          color: "#e2e8f0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px" }}>
          <OgChipIcon size={48} />
          <span style={{ fontSize: "24px", color: "#94a3b8" }}>{domain}</span>
        </div>
        <div style={{ display: "flex", marginBottom: "48px" }}>
          <span style={{ fontSize: "48px", fontWeight: 700 }}>Stats</span>
        </div>
        <div style={{ display: "flex", gap: "32px" }}>
          {stats.map((s) => (
            <div
              key={s.label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                background: "#334155",
                borderRadius: "16px",
                padding: "24px 36px",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: "40px" }}>{s.value}</span>
              <span style={{ color: "#94a3b8", fontSize: "18px" }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
