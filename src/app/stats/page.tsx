import type { Metadata } from "next";
import Link from "next/link";
import { ArrowPathRoundedSquareIcon, HeartIcon } from "@heroicons/react/24/outline";
import { getGlobals } from "@/lib/globals";
import { getGlobalStats, getPerBotStats, getTopPosts } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { config, domain, db } = getGlobals();
  const botCount = Object.keys(config.bots).length;
  const global = await getGlobalStats(db);
  const fmt = (n: number) => n.toLocaleString("en-US");
  return {
    title: `Stats`,
    description: `Statistics for ${fmt(botCount)} bots, ${fmt(global.totalPosts)} posts, and ${fmt(global.totalFollowers)} followers on ${domain}.`,
    openGraph: {
      title: `Stats – ${domain}`,
      description: `Statistics for ${fmt(botCount)} bots, ${fmt(global.totalPosts)} posts, and ${fmt(global.totalFollowers)} followers on ${domain}.`,
      url: `https://${domain}/stats`,
    },
  };
}

export default async function StatsPage() {
  const { config, db } = getGlobals();
  const botCount = Object.keys(config.bots).length;
  const [global, perBot, topPosts] = await Promise.all([
    getGlobalStats(db),
    getPerBotStats(db),
    getTopPosts(db, 20),
  ]);

  const fmt = (n: number) => n.toLocaleString("en-US");
  const sortedBots = [...perBot].sort((a, b) =>
    a.botUsername.localeCompare(b.botUsername),
  );
  const filteredTopPosts = topPosts.filter(
    (p) => p.likeCount + p.boostCount > 0,
  );

  return (
    <>
      <Link href="/" className="btn btn-ghost btn-sm gap-1 mb-6 -ml-2">
        <span>&larr;</span> All bots
      </Link>
      <h1 className="text-3xl font-display font-bold tracking-tight mb-6">
        Stats
      </h1>

      <div className="stats shadow bg-base-200 w-full stats-vertical sm:stats-horizontal">
        <div className="stat">
          <div className="stat-title">Bots</div>
          <div className="stat-value">{fmt(botCount)}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Posts</div>
          <div className="stat-value">{fmt(global.totalPosts)}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Followers</div>
          <div className="stat-value">{fmt(global.totalFollowers)}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Likes</div>
          <div className="stat-value">{fmt(global.totalLikes)}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Boosts</div>
          <div className="stat-value">{fmt(global.totalBoosts)}</div>
        </div>
      </div>

      <h2 className="text-xl font-display font-bold mt-8 mb-4">Per Bot</h2>
      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Bot</th>
              <th className="hidden sm:table-cell">Name</th>
              <th className="text-right">Posts</th>
              <th className="text-right">Followers</th>
              <th className="text-right">Likes</th>
              <th className="text-right">Boosts</th>
              <th className="text-right">Latest</th>
            </tr>
          </thead>
          <tbody>
            {sortedBots.map((bot) => {
              const displayName =
                config.bots[bot.botUsername]?.display_name ?? bot.botUsername;
              return (
                <tr key={bot.botUsername}>
                  <td>
                    <Link
                      href={`/@${bot.botUsername}`}
                      className="link link-hover font-mono text-sm"
                    >
                      @{bot.botUsername}
                    </Link>
                  </td>
                  <td className="hidden sm:table-cell">{displayName}</td>
                  <td className="text-right">{fmt(bot.postCount)}</td>
                  <td className="text-right">{fmt(bot.followerCount)}</td>
                  <td className="text-right">{fmt(bot.totalLikes)}</td>
                  <td className="text-right">{fmt(bot.totalBoosts)}</td>
                  <td className="text-right text-xs text-base-content/50">
                    {bot.latestPostAt
                      ? new Date(bot.latestPostAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredTopPosts.length > 0 && (
        <>
          <h2 className="text-xl font-display font-bold mt-8 mb-4">
            Top Posts
          </h2>
          <ul className="divide-y divide-base-300">
            {filteredTopPosts.map((post, i) => (
              <li
                key={i}
                className="flex items-baseline justify-between gap-4 py-2"
              >
                <span className="min-w-0">
                  <a
                    href={post.url}
                    className="link link-hover font-medium"
                  >
                    {post.title}
                  </a>
                  <span className="text-xs text-base-content/50 ml-1">
                    via{" "}
                    <Link
                      href={`/@${post.botUsername}`}
                      className="link link-hover font-mono"
                    >
                      @{post.botUsername}
                    </Link>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-base-content/50">
                    {post.boostCount > 0 && (
                      <span title="Boosts" className="inline-flex items-center gap-0.5"><ArrowPathRoundedSquareIcon className="w-3.5 h-3.5" /> {post.boostCount}</span>
                    )}
                    {post.likeCount > 0 && (
                      <span title="Likes" className="inline-flex items-center gap-0.5"><HeartIcon className="w-3.5 h-3.5" /> {post.likeCount}</span>
                    )}
                  </span>
                </span>
                {post.publishedAt && (
                  <time
                    dateTime={post.publishedAt.toISOString()}
                    className="text-xs text-base-content/50 whitespace-nowrap"
                  >
                    {post.publishedAt.toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
