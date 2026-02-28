import { ImageResponse } from "next/og";
import { getGlobals } from "@/lib/globals";
import { getGlobalStats } from "@/lib/db";

export const alt = "Stats";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const chipIcon = (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="#94a3b8">
    <path d="M16.5 7.5h-9v9h9v-9Z" />
    <path
      fillRule="evenodd"
      d="M8.25 2.25A.75.75 0 0 1 9 3v.75h2.25V3a.75.75 0 0 1 1.5 0v.75H15V3a.75.75 0 0 1 1.5 0v.75h.75a3 3 0 0 1 3 3v.75H21A.75.75 0 0 1 21 9h-.75v2.25H21a.75.75 0 0 1 0 1.5h-.75V15H21a.75.75 0 0 1 0 1.5h-.75v.75a3 3 0 0 1-3 3h-.75V21a.75.75 0 0 1-1.5 0v-.75h-2.25V21a.75.75 0 0 1-1.5 0v-.75H9V21a.75.75 0 0 1-1.5 0v-.75h-.75a3 3 0 0 1-3-3v-.75H3A.75.75 0 0 1 3 15h.75v-2.25H3a.75.75 0 0 1 0-1.5h.75V9H3a.75.75 0 0 1 0-1.5h.75v-.75a3 3 0 0 1 3-3h.75V3a.75.75 0 0 1 .75-.75ZM6 6.75A.75.75 0 0 1 6.75 6h10.5a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75H6.75a.75.75 0 0 1-.75-.75V6.75Z"
      clipRule="evenodd"
    />
  </svg>
);

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
          {chipIcon}
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
