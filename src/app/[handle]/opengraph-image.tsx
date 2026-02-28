import { ImageResponse } from "next/og";
import { getGlobals } from "@/lib/globals";
import { countEntries, countFollowers } from "@/lib/db";

export const alt = "Bot Profile";
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

export default async function OgImage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  if (!handle.startsWith("@")) {
    return new Response("Not found", { status: 404 });
  }
  const username = handle.slice(1);
  const { config, domain, db } = getGlobals();
  const bot = config.bots[username];
  if (!bot) {
    return new Response("Not found", { status: 404 });
  }

  const [postCount, followerCount] = await Promise.all([
    countEntries(db, username),
    countFollowers(db, username),
  ]);

  const fmt = (n: number) => n.toLocaleString("en-US");

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
        <div style={{ display: "flex", alignItems: "center", gap: "24px", marginBottom: "24px" }}>
          {bot.profile_photo ? (
            <img
              src={bot.profile_photo}
              alt=""
              width={96}
              height={96}
              style={{ borderRadius: "50%", border: "3px solid #475569" }}
            />
          ) : (
            <div
              style={{
                width: "96px",
                height: "96px",
                borderRadius: "50%",
                border: "3px solid #475569",
                background: "#334155",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {chipIcon}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: "48px", fontWeight: 700 }}>
              {bot.display_name}
            </span>
            <span style={{ fontSize: "24px", color: "#94a3b8" }}>
              @{username}@{domain}
            </span>
          </div>
        </div>
        <div
          style={{
            fontSize: "24px",
            color: "#94a3b8",
            lineHeight: 1.5,
            maxWidth: "900px",
            marginBottom: "32px",
          }}
        >
          {bot.summary}
        </div>
        <div style={{ display: "flex", gap: "40px", fontSize: "22px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: "32px" }}>{fmt(postCount)}</span>
            <span style={{ color: "#64748b" }}>posts</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: "32px" }}>{fmt(followerCount)}</span>
            <span style={{ color: "#64748b" }}>followers</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
