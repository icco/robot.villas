export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { PostFeed } from "@/components/feed-entries";
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
  const { db, domain } = getGlobals();

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

      <PostFeed domain={domain} entries={entries} />

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
