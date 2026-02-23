import { Hono } from "hono";
import { federation as fedifyMiddleware } from "@fedify/hono";
import type { Federation } from "@fedify/fedify";
import escapeHtml from "escape-html";
import type { FeedsConfig } from "./config.js";
import { countEntries, countFollowers, getEntriesPage, type Db } from "./db.js";

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
          return `<li>${photoHtml}<a href="/@${escapeHtml(username)}">@${escapeHtml(username)}</a> – ${escapeHtml(bot.display_name)} <small style="color:#666">(${escapeHtml(bot.summary)})</small></li>`;
        },
      )
      .join("\n");
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(domain)} – RSS-to-Mastodon Bridge</title>
</head>
<body>
  <h1>${escapeHtml(domain)}</h1>
  <p><strong>${escapeHtml(domain)}</strong> is an <strong>RSS-to-Mastodon bridge</strong>. It runs a collection of bot accounts, each mirroring a public RSS or Atom feed. New posts from each feed are automatically published as toots, so you can follow your favorite blogs, news sites, and newsletters directly from Mastodon or any ActivityPub-compatible server (Pleroma, Misskey, GoToSocial, etc.).</p>
  <h3>How it works</h3>
  <ol>
    <li>Pick a bot from the list below.</li>
    <li>Search for its handle (e.g. <code>@hackernews@${escapeHtml(domain)}</code>) on your Mastodon instance, or click "Follow on Mastodon" on its profile page.</li>
    <li>New items from the RSS feed will appear in your home timeline.</li>
  </ol>
  <h2>Bots</h2>
  <ul>
${botList}
  </ul>
  <p><a href="https://github.com/icco/robot.villas">Source code</a></p>
</body>
</html>`;
    return c.html(html);
  });

  app.get("/users/:username", (c) => {
    const username = c.req.param("username") as string;
    if (!(username in config.bots)) return c.notFound();
    return c.redirect(`/@${username}`);
  });

  app.get("/:handle", async (c) => {
    const handle = c.req.param("handle") as string;
    if (!handle.startsWith("@")) return c.notFound();
    const username = handle.slice(1);
    if (!(username in config.bots)) return c.notFound();

    const bot = config.bots[username];
    const page = parseInt(c.req.query("page") || "0", 10);
    const offset = Math.max(0, page) * PROFILE_PAGE_SIZE;
    const [total, followerCount, entries] = await Promise.all([
      countEntries(db, username),
      countFollowers(db, username),
      getEntriesPage(db, username, PROFILE_PAGE_SIZE, offset),
    ]);
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
  <title>${escapeHtml(bot.display_name)} (@${escapeHtml(username)}@${escapeHtml(domain)}) – ${escapeHtml(domain)}</title>
  <script type="module" src="https://unpkg.com/mastodon-widget"></script>
</head>
<body>
  <header>
    ${photoHtml}
    <h1>${escapeHtml(bot.display_name)}</h1>
    <p><code>@${escapeHtml(username)}@${escapeHtml(domain)}</code></p>
    <p>${escapeHtml(bot.summary)}</p>
    <p style="font-size:0.9em;color:#666">This is a bot that mirrors an RSS feed. Source: <a href="${escapeHtml(bot.feed_url)}">${escapeHtml(bot.feed_url)}</a></p>
    <mastodon-follow account="${escapeHtml(username)}@${escapeHtml(domain)}" style="margin-top:0.75em;display:inline-block">
      <button style="cursor:pointer">Follow on Mastodon</button>
    </mastodon-follow>
  </header>
  <dl style="display:flex;gap:2em;margin:1em 0">
    <div><dt style="font-size:0.85em;color:#666">Posts</dt><dd style="margin:0;font-size:1.25em;font-weight:bold">${total.toLocaleString("en-US")}</dd></div>
    <div><dt style="font-size:0.85em;color:#666">Followers</dt><dd style="margin:0;font-size:1.25em;font-weight:bold">${followerCount.toLocaleString("en-US")}</dd></div>
  </dl>
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
