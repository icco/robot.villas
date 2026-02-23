import { Hono } from "hono";
import { federation as fedifyMiddleware } from "@fedify/hono";
import type { Federation } from "@fedify/fedify";
import escapeHtml from "escape-html";
import type { FeedsConfig } from "./config.js";
import { countEntries, countFollowers, getEntriesPage, type Db } from "./db.js";
import { layout } from "./layout.js";

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
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([username, bot]) => {
        const photoHtml = bot.profile_photo
          ? `<img src="${escapeHtml(bot.profile_photo)}" alt="" width="24" height="24" class="rounded-full">`
          : `<div class="w-6 h-6 rounded-full bg-base-300 flex items-center justify-center text-xs">🤖</div>`;
        return `<a href="/@${escapeHtml(username)}" class="flex items-center gap-3 p-3 rounded-lg hover:bg-base-200 transition-colors group">
          ${photoHtml}
          <div class="min-w-0">
            <span class="font-mono text-sm font-semibold group-hover:text-primary transition-colors">@${escapeHtml(username)}</span>
            <span class="text-base-content/60 mx-1">–</span>
            <span class="font-medium">${escapeHtml(bot.display_name)}</span>
            <p class="text-xs text-base-content/50 truncate">${escapeHtml(bot.summary)}</p>
          </div>
        </a>`;
      })
      .join("\n");

    const content = `
      <div class="mb-8">
        <h1 class="text-4xl font-display font-bold tracking-tight mb-4">${escapeHtml(domain)}</h1>
        <p class="text-base-content/80 text-lg leading-relaxed max-w-2xl">
          An <strong class="font-semibold">RSS-to-Mastodon bridge</strong>. A collection of bot accounts, each mirroring a public RSS or Atom feed. Follow your favorite blogs, news sites, and newsletters from Mastodon or any ActivityPub-compatible server.
        </p>
      </div>
      <div class="card bg-base-200 mb-8">
        <div class="card-body">
          <h3 class="card-title font-display text-lg">How it works</h3>
          <ol class="list-decimal list-inside space-y-2 text-sm text-base-content/80">
            <li>Pick a bot from the list below.</li>
            <li>Search for its handle (e.g. <code class="bg-base-300 px-1.5 py-0.5 rounded font-mono text-xs">@hackernews@${escapeHtml(domain)}</code>) on your Mastodon instance, or click "Follow on Mastodon" on its profile page.</li>
            <li>New items from the RSS feed will appear in your home timeline.</li>
          </ol>
        </div>
      </div>
      <h2 class="text-2xl font-display font-bold mb-4">Bots</h2>
      <div class="divide-y divide-base-300">
        ${botList}
      </div>`;

    return c.html(layout({
      title: `${domain} – RSS-to-Mastodon Bridge`,
      domain,
      content,
    }));
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
      ? `<img src="${escapeHtml(bot.profile_photo)}" alt="" width="96" height="96" class="rounded-full ring-2 ring-base-300">`
      : `<div class="w-24 h-24 rounded-full bg-base-300 flex items-center justify-center text-4xl ring-2 ring-base-300">🤖</div>`;

    const entriesHtml = entries.length > 0
      ? entries.map((entry) => {
          const date = entry.publishedAt
            ? `<time datetime="${entry.publishedAt.toISOString()}" class="text-xs text-base-content/50 whitespace-nowrap">${entry.publishedAt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</time>`
            : "";
          const link = entry.url
            ? `<a href="${escapeHtml(entry.url)}" class="link link-hover font-medium">${escapeHtml(entry.title)}</a>`
            : `<span class="font-medium">${escapeHtml(entry.title)}</span>`;
          return `<li class="flex items-baseline justify-between gap-4 py-2">${link}${date}</li>`;
        }).join("\n")
      : `<li class="py-4 text-base-content/50 italic">No posts yet.</li>`;

    const paginationHtml = (hasPrev || hasNext)
      ? `<div class="join mt-6">${hasPrev ? `<a href="/@${escapeHtml(username)}?page=${page - 1}" class="join-item btn btn-sm">&laquo; Newer</a>` : ""}${hasNext ? `<a href="/@${escapeHtml(username)}?page=${page + 1}" class="join-item btn btn-sm">Older &raquo;</a>` : ""}</div>`
      : "";

    const content = `
      <a href="/" class="btn btn-ghost btn-sm gap-1 mb-6 -ml-2">
        <span>&larr;</span> All bots
      </a>
      <div class="flex items-start gap-6 mb-6">
        ${photoHtml}
        <div>
          <h1 class="text-3xl font-display font-bold tracking-tight">${escapeHtml(bot.display_name)}</h1>
          <p class="font-mono text-sm text-base-content/60 mt-1">@${escapeHtml(username)}@${escapeHtml(domain)}</p>
          <p class="mt-2 text-base-content/80">${escapeHtml(bot.summary)}</p>
          <p class="text-sm text-base-content/50 mt-2">Source: <a href="${escapeHtml(bot.feed_url)}" class="link link-hover">${escapeHtml(bot.feed_url)}</a></p>
          <div class="flex items-center gap-3 mt-3 flex-wrap">
            <mastodon-follow account="${escapeHtml(username)}@${escapeHtml(domain)}" class="inline-block">
              <button class="btn btn-primary btn-sm">Follow on Mastodon</button>
            </mastodon-follow>
            <div class="stats shadow bg-base-200">
              <div class="stat px-4 py-2">
                <div class="stat-title text-xs">Followers</div>
                <div class="stat-value text-lg">${followerCount.toLocaleString("en-US")}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="stats shadow bg-base-200 mb-8">
        <div class="stat">
          <div class="stat-title">Posts</div>
          <div class="stat-value text-2xl">${total.toLocaleString("en-US")}</div>
        </div>
      </div>
      <h2 class="text-xl font-display font-bold mb-3">Posts</h2>
      <ul class="divide-y divide-base-300">
        ${entriesHtml}
      </ul>
      ${paginationHtml}`;

    return c.html(layout({
      title: `${bot.display_name} (@${username}@${domain}) – ${domain}`,
      domain,
      content,
      extraHead: `<script type="module" src="https://unpkg.com/mastodon-widget"></script>`,
    }));
  });

  return app;
}
