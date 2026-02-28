import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowPathRoundedSquareIcon, HeartIcon, CpuChipIcon } from "@heroicons/react/24/outline";
import { getGlobals } from "@/lib/globals";
import { countEntries, countFollowers, getEntriesPage } from "@/lib/db";
import { MastodonWidgets } from "./mastodon-widgets";

const PROFILE_PAGE_SIZE = 40;

interface Props {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  if (!handle.startsWith("@")) {
    return {};
  }
  const username = handle.slice(1);
  const { config, domain } = getGlobals();
  const bot = config.bots[username];
  if (!bot) {
    return {};
  }
  return {
    title: `${bot.display_name} (@${username}@${domain})`,
    description: bot.summary,
    openGraph: {
      title: `${bot.display_name} (@${username}@${domain}) – ${domain}`,
      description: bot.summary,
      url: `https://${domain}/@${username}`,
    },
  };
}

export default async function BotProfilePage({ params, searchParams }: Props) {
  const { handle } = await params;
  if (!handle.startsWith("@")) {
    notFound();
  }
  const username = handle.slice(1);
  const { config, domain, db } = getGlobals();
  const bot = config.bots[username];
  if (!bot) {
    notFound();
  }

  const { page: pageParam } = await searchParams;
  const page = parseInt(pageParam || "0", 10);
  const offset = Math.max(0, page) * PROFILE_PAGE_SIZE;
  const [total, followerCount, entries] = await Promise.all([
    countEntries(db, username),
    countFollowers(db, username),
    getEntriesPage(db, username, PROFILE_PAGE_SIZE, offset),
  ]);
  const hasNext = offset + entries.length < total;
  const hasPrev = offset > 0;

  return (
    <>
      <Link href="/" className="btn btn-ghost btn-sm gap-1 mb-6 -ml-2">
        <span>&larr;</span> All bots
      </Link>

      <div className="flex items-start gap-6 mb-6">
        {bot.profile_photo ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={bot.profile_photo}
            alt=""
            width={96}
            height={96}
            className="rounded-full ring-2 ring-base-300"
          />
        ) : (
          <div className="w-24 h-24 rounded-full bg-base-300 flex items-center justify-center ring-2 ring-base-300">
            <CpuChipIcon className="w-10 h-10 text-base-content/50" />
          </div>
        )}
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">
            {bot.display_name}
          </h1>
          <p className="font-mono text-sm text-base-content/60 mt-1">
            @{username}@{domain}
          </p>
          <p className="mt-2 text-base-content/80">{bot.summary}</p>
          <p className="text-sm text-base-content/50 mt-2">
            Source:{" "}
            <a href={bot.feed_url} className="link link-hover">
              {bot.feed_url}
            </a>
          </p>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {/* @ts-expect-error -- custom element from mastodon-widget */}
            <mastodon-follow
              account={`${username}@${domain}`}
              className="inline-block"
            >
              <button type="button" className="btn btn-primary btn-sm">
                Follow on Mastodon
              </button>
            {/* @ts-expect-error -- custom element */}
            </mastodon-follow>
            <div className="stats shadow bg-base-200">
              <div className="stat px-4 py-2">
                <div className="stat-title text-xs">Posts</div>
                <div className="stat-value text-lg">
                  {total.toLocaleString("en-US")}
                </div>
              </div>
              <div className="stat px-4 py-2">
                <div className="stat-title text-xs">Followers</div>
                <div className="stat-value text-lg">
                  {followerCount.toLocaleString("en-US")}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <h2 className="text-xl font-display font-bold mb-3">Posts</h2>
      <ul className="divide-y divide-base-300">
        {entries.length > 0 ? (
          entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-baseline justify-between gap-4 py-2"
            >
              <span className="flex items-baseline gap-3 min-w-0">
                {entry.url ? (
                  <a
                    href={entry.url}
                    className="link link-hover font-medium"
                  >
                    {entry.title}
                  </a>
                ) : (
                  <span className="font-medium">{entry.title}</span>
                )}
              </span>
              <span className="flex items-center gap-1 shrink-0">
                {entry.url ? (
                  /* @ts-expect-error -- custom element */
                  <mastodon-interact uri={entry.url} className="inline-block">
                    <button
                      type="button"
                      title="Boost"
                      className="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-info"
                    >
                      <ArrowPathRoundedSquareIcon className="w-4 h-4" /> {entry.boostCount}
                    </button>
                  {/* @ts-expect-error -- custom element */}
                  </mastodon-interact>
                ) : (
                  <span className="btn btn-ghost btn-xs gap-1 text-base-content/50">
                    <ArrowPathRoundedSquareIcon className="w-4 h-4" /> {entry.boostCount}
                  </span>
                )}
                {entry.url ? (
                  /* @ts-expect-error -- custom element */
                  <mastodon-interact uri={entry.url} className="inline-block">
                    <button
                      type="button"
                      title="Favorite"
                      className="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-error"
                    >
                      <HeartIcon className="w-4 h-4" /> {entry.likeCount}
                    </button>
                  {/* @ts-expect-error -- custom element */}
                  </mastodon-interact>
                ) : (
                  <span className="btn btn-ghost btn-xs gap-1 text-base-content/50">
                    <HeartIcon className="w-4 h-4" /> {entry.likeCount}
                  </span>
                )}
                {entry.publishedAt && (
                  <time
                    dateTime={entry.publishedAt.toISOString()}
                    className="text-xs text-base-content/50 whitespace-nowrap"
                  >
                    {entry.publishedAt.toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                )}
              </span>
            </li>
          ))
        ) : (
          <li className="py-4 text-base-content/50 italic">No posts yet.</li>
        )}
      </ul>

      {(hasPrev || hasNext) && (
        <div className="join mt-6">
          {hasPrev && (
            <a
              href={`/@${username}?page=${page - 1}`}
              className="join-item btn btn-sm"
            >
              &laquo; Newer
            </a>
          )}
          {hasNext && (
            <a
              href={`/@${username}?page=${page + 1}`}
              className="join-item btn btn-sm"
            >
              Older &raquo;
            </a>
          )}
        </div>
      )}

      <MastodonWidgets />
    </>
  );
}
