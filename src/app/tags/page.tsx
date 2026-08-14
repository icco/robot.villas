export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { getGlobals } from "@/lib/globals";
import { getTagsPage } from "@/lib/db";
import { parsePageParam } from "@/lib/pagination";

const PAGE_SIZE = 100;

interface Props {
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const { domain } = getGlobals();
  return {
    title: "Tags",
    description: `All hashtags used across posts on ${domain}`,
  };
}

export default async function TagsPage({ searchParams }: Props) {
  const { db } = getGlobals();

  const { page: pageParam } = await searchParams;
  const page = parsePageParam(pageParam);
  const offset = page * PAGE_SIZE;

  const { tags, total } = await getTagsPage(db, PAGE_SIZE, offset);

  const hasNext = offset + tags.length < total;
  const hasPrev = page > 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-display font-bold tracking-tight">Tags</h1>
        {/* `total` rides along on the page's rows, so it's 0 out of range. */}
        {(total > 0 || !hasPrev) && (
          <p className="text-base-content/60 mt-1">
            {total.toLocaleString("en-US")} tag{total !== 1 ? "s" : ""}
            {total > PAGE_SIZE && (
              <>
                {" · "}page {(page + 1).toLocaleString("en-US")} of{" "}
                {pageCount.toLocaleString("en-US")}
              </>
            )}
          </p>
        )}
      </div>

      <ul className="divide-y divide-base-300">
        {tags.map(({ tag, postCount }) => (
          <li
            key={tag}
            className="flex items-baseline justify-between gap-x-4 py-2"
          >
            <Link
              href={`/tags/${encodeURIComponent(tag)}`}
              className="min-w-0 break-all text-sm font-mono font-semibold text-base-content hover:underline underline-offset-2"
            >
              #{tag}
            </Link>
            <span className="shrink-0 text-xs text-base-content/50 whitespace-nowrap">
              {postCount.toLocaleString("en-US")} post{postCount !== 1 ? "s" : ""}
            </span>
          </li>
        ))}
      </ul>

      {tags.length === 0 && (
        <p className="text-base-content/50 text-sm">
          {hasPrev ? "No tags on this page." : "No tags yet."}
        </p>
      )}

      {(hasPrev || hasNext) && (
        <div className="join mt-6">
          {hasPrev && (
            <Link href={`/tags?page=${page - 1}`} className="join-item btn btn-sm">
              &laquo; Previous
            </Link>
          )}
          {hasNext && (
            <Link href={`/tags?page=${page + 1}`} className="join-item btn btn-sm">
              Next &raquo;
            </Link>
          )}
        </div>
      )}
    </>
  );
}
