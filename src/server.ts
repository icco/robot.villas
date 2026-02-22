import { Hono } from "hono";
import { federation as fedifyMiddleware } from "@fedify/hono";
import type { Federation } from "@fedify/fedify";
import type { FeedsConfig } from "./config.js";
import { countEntries, getEntriesPage, type Db } from "./db.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PROFILE_PAGE_SIZE = 40;

export function createApp(
  fed: Federation<void>,
  config: FeedsConfig,
  domain: string,
  db: Db,
): Hono {
  const app = new Hono();

  app.use(fedifyMiddleware(fed, () => undefined));

  app.get("/healthcheck", (c) => c.text("ok"));

  app.get("/", (c) => {
    const botList = Object.entries(config.bots)
      .map(
        ([username, bot]) => {
          const photoHtml = bot.profile_photo
            ? `<img src="${escapeHtml(bot.profile_photo)}" alt="" width="24" height="24" style="vertical-align:middle;border-radius:50%;margin-right:6px">`
            : "";
          return `<li>${photoHtml}<a href="/@${escapeHtml(username)}">@${escapeHtml(username)}</a> – ${escapeHtml(bot.display_name)}</li>`;
        },
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

  app.get("/@:username", async (c) => {
    const username = c.req.param("username") as string;
    if (!(username in config.bots)) return c.notFound();

    const bot = config.bots[username];
    const page = parseInt(c.req.query("page") || "0", 10);
    const offset = Math.max(0, page) * PROFILE_PAGE_SIZE;
    const total = await countEntries(db, username);
    const entries = await getEntriesPage(db, username, PROFILE_PAGE_SIZE, offset);
    const hasNext = offset + entries.length < total;
    const hasPrev = offset > 0;

    const photoHtml = bot.profile_photo
      ? `<img src="${escapeHtml(bot.profile_photo)}" alt="" width="96" height="96" style="border-radius:50%">`
      : "";

    const entriesHtml = entries.length > 0
      ? entries.map((entry) => {
          const date = entry.publishedAt
            ? `<time datetime="${entry.publishedAt.toISOString()}">${entry.publishedAt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</time>`
            : "";
          const link = entry.url
            ? `<a href="${escapeHtml(entry.url)}">${escapeHtml(entry.title)}</a>`
            : escapeHtml(entry.title);
          return `<li>${link}${date ? ` <small>${date}</small>` : ""}</li>`;
        }).join("\n")
      : "<li><em>No posts yet.</em></li>";

    const paginationHtml = (hasPrev || hasNext)
      ? `<nav style="margin-top:1em">${hasPrev ? `<a href="/@${escapeHtml(username)}?page=${page - 1}">&laquo; Newer</a>` : ""}${hasPrev && hasNext ? " | " : ""}${hasNext ? `<a href="/@${escapeHtml(username)}?page=${page + 1}">Older &raquo;</a>` : ""}</nav>`
      : "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>@${escapeHtml(username)}@${escapeHtml(domain)}</title>
</head>
<body>
  <header>
    ${photoHtml}
    <h1>${escapeHtml(bot.display_name)}</h1>
    <p><code>@${escapeHtml(username)}@${escapeHtml(domain)}</code></p>
    <p>${escapeHtml(bot.summary)}</p>
  </header>
  <h2>Posts</h2>
  <ul>
${entriesHtml}
  </ul>
  ${paginationHtml}
  <p style="margin-top:2em"><a href="/">&larr; All bots</a></p>
</body>
</html>`;
    return c.html(html);
  });

  return app;
}
