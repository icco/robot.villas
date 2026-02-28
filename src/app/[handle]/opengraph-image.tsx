import { ImageResponse } from "next/og";
import { getGlobals } from "@/lib/globals";
import { countEntries, countFollowers } from "@/lib/db";
import { OgChipIcon } from "@/lib/og-icon";

export const alt = "Bot Profile";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
              <OgChipIcon size={48} />
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
