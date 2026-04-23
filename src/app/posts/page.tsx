export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowPathRoundedSquareIcon, HeartIcon } from "@heroicons/react/24/outline";
import { getGlobals } from "@/lib/globals";
import { getAllEntries, countAllEntries } from "@/lib/db";

const PAGE_SIZE = 40;

interface Props {
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const { domain } = getGlobals();
  return {
    title: "All Posts",
    description: `All posts on ${domain} in chronological order`,
  };
}

export default async function PostsPage({ searchParams }: Props) {
  const { db } = getGlobals();

  const { page: pageParam } = await searchParams;
  const page = Math.max(0, parseInt(pageParam || "0", 10));
  const offset = page * PAGE_SIZE;

  const [total, entries] = await Promise.all([
    countAllEntries(db),
    getAllEntries(db, PAGE_SIZE, offset),
  ]);

  const hasNext = offset + entries.length < total;
  const hasPrev = page > 0;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-display font-bold tracking-tight">All Posts</h1>
        <p className="text-base-content/60 mt-1">
          {total.toLocaleString("en-US")} post{total !== 1 ? "s" : ""}
        </p>
      </div>

      <ul className="divide-y divide-base-300">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex items-baseline justify-between gap-4 py-2"
          >
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
              <Link
                href={`/@${entry.botUsername}`}
                className="text-xs text-base-content/50 font-mono shrink-0"
              >
                @{entry.botUsername}
              </Link>
              {entry.url ? (
                <a href={entry.url} className="link link-hover font-medium">
                  {entry.title}
                </a>
              ) : (
                <span className="font-medium">{entry.title}</span>
              )}
              {entry.hashtags.length > 0 && (
                <span className="flex gap-1 flex-wrap">
                  {entry.hashtags.map((t) => (
                    <Link
                      key={t}
                      href={`/tags/${encodeURIComponent(t.toLowerCase())}`}
                      className="text-xs font-mono text-base-content/40 hover:text-primary/70"
                    >
                      #{t}
                    </Link>
                  ))}
                </span>
              )}
            </span>
            <span className="flex items-center gap-1 shrink-0">
              <span
                title="Boosts"
                className="btn btn-ghost btn-xs gap-1 text-base-content/50 cursor-default"
              >
                <ArrowPathRoundedSquareIcon className="w-4 h-4" /> {entry.boostCount}
              </span>
              <span
                title="Favorites"
                className="btn btn-ghost btn-xs gap-1 text-base-content/50 cursor-default"
              >
                <HeartIcon className="w-4 h-4" /> {entry.likeCount}
              </span>
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
        ))}
      </ul>

      {(hasPrev || hasNext) && (
        <div className="join mt-6">
          {hasPrev && (
            <Link
              href={`/posts?page=${page - 1}`}
              className="join-item btn btn-sm"
            >
              &laquo; Newer
            </Link>
          )}
          {hasNext && (
            <Link
              href={`/posts?page=${page + 1}`}
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
