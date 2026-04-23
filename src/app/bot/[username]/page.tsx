import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CpuChipIcon } from "@heroicons/react/24/solid";
import { PostFeed } from "@/components/feed-entries";
import { getGlobals } from "@/lib/globals";
import {
  countAcceptedFollowing,
  countEntries,
  countFollowers,
  getEntriesPage,
} from "@/lib/db";
import { FollowButton } from "./mastodon-widgets";

const PROFILE_PAGE_SIZE = 40;

interface Props {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const { config, domain } = getGlobals();
  const bot = config.bots[username];
  if (!bot) {
    return {};
  }
  return {
    title: `${bot.display_name} (@${username}@${domain})`,
    description: bot.summary,
    alternates: {
      canonical: `https://${domain}/@${username}`,
    },
    openGraph: {
      title: `${bot.display_name} (@${username}@${domain}) – ${domain}`,
      description: bot.summary,
      url: `https://${domain}/@${username}`,
    },
  };
}

export default async function BotProfilePage({ params, searchParams }: Props) {
  const { username } = await params;
  const { config, domain, db } = getGlobals();
  const bot = config.bots[username];
  if (!bot) {
    notFound();
  }

  const { page: pageParam } = await searchParams;
  const page = parseInt(pageParam || "0", 10);
  const offset = Math.max(0, page) * PROFILE_PAGE_SIZE;
  const [total, followerCount, followingCount, entries] = await Promise.all([
    countEntries(db, username),
    countFollowers(db, username),
    countAcceptedFollowing(db, username),
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
            <FollowButton account={`${username}@${domain}`}>
              <button type="button" className="btn btn-primary btn-sm">
                Follow on Mastodon
              </button>
            </FollowButton>
            <div className="stats shadow bg-base-200">
              <div className="stat px-4 py-2">
                <div className="stat-title text-xs">Posts</div>
                <div className="stat-value text-lg">
                  {total.toLocaleString("en-US")}
                </div>
              </div>
              <Link href={`/@${username}/followers`} className="stat px-4 py-2 hover:bg-base-300/60 transition-colors">
                <div className="stat-title text-xs">Followers</div>
                <div className="stat-value text-lg">
                  {followerCount.toLocaleString("en-US")}
                </div>
              </Link>
              <Link href={`/@${username}/following`} className="stat px-4 py-2 hover:bg-base-300/60 transition-colors">
                <div className="stat-title text-xs">Following</div>
                <div className="stat-value text-lg">
                  {followingCount.toLocaleString("en-US")}
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <h2 className="text-xl font-display font-bold mb-3">Posts</h2>
      <PostFeed
        domain={domain}
        entries={entries}
        emptyMessage="No posts yet."
        showBotHandle={false}
      />

      {(hasPrev || hasNext) && (
        <div className="join mt-6">
          {hasPrev && (
            <Link
              href={`/@${username}?page=${page - 1}`}
              className="join-item btn btn-sm"
            >
              &laquo; Newer
            </Link>
          )}
          {hasNext && (
            <Link
              href={`/@${username}?page=${page + 1}`}
              className="join-item btn btn-sm"
            >
              Older &raquo;
            </Link>
          )}
        </div>
      )}

    </>
  );
}
