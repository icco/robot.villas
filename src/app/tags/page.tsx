export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { hashtagClassNames } from "@/lib/hashtag-classnames";
import { getGlobals } from "@/lib/globals";
import { getAllTags } from "@/lib/db";

export async function generateMetadata(): Promise<Metadata> {
  const { domain } = getGlobals();
  return {
    title: "Tags",
    description: `All hashtags used across posts on ${domain}`,
  };
}

export default async function TagsPage() {
  const { db } = getGlobals();
  const tags = await getAllTags(db);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-display font-bold tracking-tight">Tags</h1>
        <p className="text-base-content/60 mt-1">
          {tags.length.toLocaleString("en-US")} tag{tags.length !== 1 ? "s" : ""}
        </p>
      </div>

      <ul className="divide-y divide-base-300">
        {tags.map(({ tag, postCount }) => (
          <li key={tag} className="flex items-center justify-between py-2">
            <Link
              href={`/tags/${encodeURIComponent(tag)}`}
              className={hashtagClassNames.link}
            >
              #{tag}
            </Link>
            <span className="text-xs text-base-content/50">
              {postCount.toLocaleString("en-US")} post{postCount !== 1 ? "s" : ""}
            </span>
          </li>
        ))}
      </ul>

      {tags.length === 0 && (
        <p className="text-base-content/50 text-sm">No tags yet.</p>
      )}
    </>
  );
}
