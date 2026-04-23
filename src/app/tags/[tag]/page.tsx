import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PostFeed } from "@/components/feed-entries";
import { getGlobals } from "@/lib/globals";
import { countEntriesByTag, getEntriesByTag } from "@/lib/db";

const PAGE_SIZE = 40;

interface Props {
  params: Promise<{ tag: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag } = await params;
  const { domain } = getGlobals();
  const displayTag = decodeURIComponent(tag);
  return {
    title: `#${displayTag}`,
    description: `Posts tagged #${displayTag} on ${domain}`,
    alternates: {
      canonical: `https://${domain}/tags/${encodeURIComponent(displayTag.toLowerCase())}`,
    },
  };
}

export default async function TagPage({ params, searchParams }: Props) {
  const { tag } = await params;
  const { db, domain } = getGlobals();
  const displayTag = decodeURIComponent(tag);

  const { page: pageParam } = await searchParams;
  const page = Math.max(0, parseInt(pageParam || "0", 10));
  const offset = page * PAGE_SIZE;

  const [total, entries] = await Promise.all([
    countEntriesByTag(db, displayTag),
    getEntriesByTag(db, displayTag, PAGE_SIZE, offset),
  ]);

  if (total === 0 && page === 0) {
    notFound();
  }

  const hasNext = offset + entries.length < total;
  const hasPrev = page > 0;

  return (
    <>
      <Link href="/" className="btn btn-ghost btn-sm gap-1 mb-6 -ml-2">
        <span>&larr;</span> All bots
      </Link>

      <div className="mb-6">
        <h1 className="text-3xl font-display font-bold tracking-tight">
          #{displayTag}
        </h1>
        <p className="text-base-content/60 mt-1">
          {total.toLocaleString("en-US")} post{total !== 1 ? "s" : ""}
        </p>
      </div>

      <PostFeed
        domain={domain}
        entries={entries}
        tagHighlight={displayTag}
      />

      {(hasPrev || hasNext) && (
        <div className="join mt-6">
          {hasPrev && (
            <Link
              href={`/tags/${encodeURIComponent(displayTag.toLowerCase())}?page=${page - 1}`}
              className="join-item btn btn-sm"
            >
              &laquo; Newer
            </Link>
          )}
          {hasNext && (
            <Link
              href={`/tags/${encodeURIComponent(displayTag.toLowerCase())}?page=${page + 1}`}
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
