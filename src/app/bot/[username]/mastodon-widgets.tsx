"use client";

import { useEffect } from "react";
import Script from "next/script";

export function MastodonWidgets() {
  useEffect(() => {
    if (!customElements.get("mastodon-interact")) {
      customElements.define(
        "mastodon-interact",
        class extends HTMLElement {
          connectedCallback() {
            this.addEventListener("click", async () => {
              let picker = this.querySelector("mastodon-instancepicker");
              if (!picker) {
                picker = document.createElement("mastodon-instancepicker");
                this.appendChild(picker);
              }
              try {
                const instance = await (
                  picker as { pickInstance: () => Promise<string> }
                ).pickInstance();
                const newWindow = window.open(
                  "https://" +
                    instance +
                    "/authorize_interaction?uri=" +
                    encodeURIComponent(this.getAttribute("uri") || ""),
                  "_blank",
                  "noopener,noreferrer",
                );
                if (newWindow) {
                  newWindow.opener = null;
                }
              } catch {
                // user cancelled
              }
              picker.remove();
            });
          }
        },
      );
    }
  }, []);

  return (
    <Script
      src="https://unpkg.com/mastodon-widget@0.2.1"
      strategy="afterInteractive"
    />
  );
}
