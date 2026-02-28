"use client";

import { useEffect } from "react";

export function MastodonWidgets() {
  useEffect(() => {
    import("mastodon-widget");

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

  return null;
}
