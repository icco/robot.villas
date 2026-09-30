import { ImageResponse } from "next/og";
import { OgChipIcon } from "@/lib/og-icon";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      height: "100%",
      background: "#1a1d2e",
    }}>
      <OgChipIcon size={384} />
    </div>,
    size,
  );
}
