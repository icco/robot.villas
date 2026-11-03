import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CpuChipIcon } from "@heroicons/react/24/solid";
import { EntryInteractButtons } from "@/components/entry-interact-buttons";
import { ReactorList } from "@/components/reactor-list";
import { getEntryForDispatch } from "@/lib/db";
import { isPgIntegerId } from "@/lib/federation";
import { entryObjectUrl } from "@/lib/feed-entry";
import { getGlobals } from "@/lib/globals";
import { safeParseUrl } from "@/lib/urls";
import { getPostReactions } from "@/lib/webmentions";

interface Props {
  params: Promise<{ username: string; id: string }>;
}

const DATE: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

async function loadPost(params: Props["params"]) {
  const { username, id } = await params;
  const { config, db, domain } = getGlobals();
  const bot = config.bots[username];
  if (!bot || !isPgIntegerId(id)) {
    return null;
  }
  const entry = await getEntryForDispatch(db, username, Number(id));
  if (!entry || entry.deletedAt) {
    return null;
  }
  return { username, bot, entry, domain, db };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await loadPost(params);
  if (!post) {
    return {};
  }
  const url = entryObjectUrl(post.domain, post.username, post.entry.id);
  return {
    title: `${post.entry.title} (${post.bot.display_name})`,
    description: post.bot.summary,
    alternates: { canonical: url },
    openGraph: { title: post.entry.title, description: post.bot.summary, url },
  };
}

export default async function PostPage({ params }: Props) {
  const post = await loadPost(params);
  if (!post) {
    notFound();
  }
  const { username, bot, entry, domain, db } = post;
  const permalink = entryObjectUrl(domain, username, entry.id);
  // Must be the exact URL webmentions name as target, or receivers reject them.
  const target = safeParseUrl(entry.webmentionTarget ?? entry.url);
  const published = entry.publishedAt ?? entry.createdAt;
  const reactors = await getPostReactions(db, entry.id);

  return (
    <>
      <Link href={`/@${username}`} className="btn btn-ghost btn-sm gap-1 mb-6 -ml-2">
        <span>&larr;</span> {bot.display_name}
      </Link>

      <article className="h-entry">
        <a href={`https://${domain}/@${username}`} className="p-author h-card flex items-center gap-3 mb-4 w-fit">
          {bot.profile_photo ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={bot.profile_photo} alt="" width={48} height={48} className="u-photo rounded-full ring-2 ring-base-300" />
          ) : (
            <span className="w-12 h-12 rounded-full bg-base-300 flex items-center justify-center">
              <CpuChipIcon className="w-6 h-6 text-base-content/50" />
            </span>
          )}
          <span>
            <span className="p-name block font-bold">{bot.display_name}</span>
            <span className="block font-mono text-xs text-base-content/60">@{username}@{domain}</span>
          </span>
        </a>

        <div className="e-content">
          <h1 className="text-2xl font-display font-bold tracking-tight break-words">
            {target ? <a href={target.href} className="link link-hover">{entry.title}</a> : entry.title}
          </h1>
          {target && (
            <p className="text-sm text-base-content/50 mt-1 break-all">
              <a href={target.href} className="link link-hover">{target.href}</a>
            </p>
          )}
        </div>

        {entry.hashtags.length > 0 && (
          <p className="mt-2 text-xs font-mono">
            {entry.hashtags.map((t) => (
              <Fragment key={t}>
                <Link href={`/tags/${encodeURIComponent(t.toLowerCase())}`} className="link link-hover text-primary/70 hover:text-primary">
                  #{t}
                </Link>{" "}
              </Fragment>
            ))}
          </p>
        )}

        <div className="flex items-center gap-3 mt-3">
          <a href={permalink} className="u-url link link-hover text-xs text-base-content/50">
            <time className="dt-published" dateTime={published.toISOString()}>
              {published.toLocaleDateString("en-US", DATE)}
            </time>
          </a>
          <EntryInteractButtons activityUri={permalink} boostCount={entry.boostCount} likeCount={entry.likeCount} />
        </div>
      </article>

      <ReactorList title="Boosted by" reactors={reactors.filter((r) => r.kind === "boost")} />
      <ReactorList title="Liked by" reactors={reactors.filter((r) => r.kind === "like")} />
    </>
  );
}
