import { Hono } from "hono";
import { federation as fedifyMiddleware } from "@fedify/hono";
import type { Federation } from "@fedify/fedify";
import type { FeedsConfig } from "./config.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createApp(
  fed: Federation<void>,
  config: FeedsConfig,
  domain: string,
): Hono {
  const app = new Hono();

  app.use(fedifyMiddleware(fed, () => undefined));

  app.get("/healthcheck", (c) => c.text("ok"));

  app.get("/", (c) => {
    const botList = Object.entries(config.bots)
      .map(
        ([username, bot]) =>
          `<li><a href="https://${domain}/users/${escapeHtml(username)}">@${escapeHtml(username)}</a> – ${escapeHtml(bot.display_name)}</li>`,
      )
      .join("\n");
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(domain)}</title>
</head>
<body>
  <h1>${escapeHtml(domain)}</h1>
  <p>This is an <strong>RSS-to-Mastodon bridge</strong>. Each bot account mirrors an RSS feed; you can follow them from any Mastodon or ActivityPub-compatible server.</p>
  <h2>Bots</h2>
  <ul>
${botList}
  </ul>
  <p><a href="https://github.com/icco/robot.villas">Source code</a></p>
</body>
</html>`;
    return c.html(html);
  });

  return app;
}
