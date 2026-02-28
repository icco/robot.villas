import { ImageResponse } from "next/og";
import { getGlobals } from "@/lib/globals";
import { OgChipIcon } from "@/lib/og-icon";

export const dynamic = "force-dynamic";
export const alt = "RSS-to-Mastodon Bridge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  const { domain, config } = getGlobals();
  const botCount = Object.keys(config.bots).length;

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
        <div style={{ display: "flex", alignItems: "center", gap: "20px", marginBottom: "32px" }}>
          <OgChipIcon size={64} />
          <span style={{ fontSize: "52px", fontWeight: 700 }}>{domain}</span>
        </div>
        <div style={{ display: "flex", fontSize: "28px", color: "#94a3b8", lineHeight: 1.5 }}>
          {`RSS-to-Mastodon bridge with ${botCount} bot${botCount !== 1 ? "s" : ""}, mirroring public feeds on the Fediverse.`}
        </div>
      </div>
    ),
    { ...size },
  );
}
