import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isPgIntegerId } from "@/lib/federation";
import { entryObjectUrl } from "@/lib/feed-entry";
import { getGlobals } from "@/lib/globals";
import { safeParseUrl } from "@/lib/urls";
import { getReactionPage, reactionPageUrl } from "@/lib/webmentions";

interface Props {
  params: Promise<{ username: string; id: string; pageId: string }>;
}

const DATE: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

async function loadReaction(params: Props["params"]) {
  const { username, id, pageId } = await params;
  const { config, db, domain } = getGlobals();
  const bot = config.bots[username];
  if (!bot || !isPgIntegerId(id) || !/^[0-9a-f]{32}$/.test(pageId)) {
    return null;
  }
  const row = await getReactionPage(db, username, Number(id), pageId);
  const target = safeParseUrl(row?.entry.webmentionTarget ?? row?.entry.url);
  return row && target ? { ...row, username, bot, domain, pageId, target } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await loadReaction(params);
  if (!found) {
    return {};
  }
  const verb = found.reaction.kind === "boost" ? "boosted" : "liked";
  return {
    title: found.named ? `${found.actor.name} ${verb} ${found.entry.title}` : `Removed ${found.reaction.kind}`,
    robots: { index: false, follow: false },
  };
}

export default async function ReactionPage({ params }: Props) {
  const found = await loadReaction(params);
  if (!found) {
    notFound();
  }
  const { reaction, entry, actor, username, bot, domain, pageId, target, named } = found;
  const postUrl = entryObjectUrl(domain, username, entry.id);

  // Webmention receivers delete a mention whose source stops linking the target.
  if (!named) {
    return (
      <p className="text-base-content/70">
        This {reaction.kind} was removed. <Link href={postUrl} className="link">Back to the post</Link>.
      </p>
    );
  }

  const boost = reaction.kind === "boost";
  const at = reaction.createdAt ?? entry.createdAt;
  return (
    <article className="h-entry">
      <p className="text-lg break-words">
        <a href={actor.profileUrl} rel="nofollow ugc" className="p-author h-card inline-flex items-center gap-2 font-bold link link-hover">
          {actor.iconUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={actor.iconUrl} alt="" width={32} height={32} className="u-photo w-8 h-8 rounded-full object-cover" />
          )}
          <span className="p-name">{actor.name}</span>
        </a>{" "}
        {boost ? "boosted" : "liked"}{" "}
        <a href={target.href} className={`${boost ? "u-repost-of" : "u-like-of"} link link-hover font-medium`}>
          {entry.title}
        </a>
      </p>
      <p className="text-sm text-base-content/60 mt-2">
        via <Link href={postUrl} className="link link-hover">{bot.display_name} on {domain}</Link>
        {" · "}
        <a href={reactionPageUrl(domain, username, entry.id, pageId)} className="u-url link link-hover">
          <time className="dt-published" dateTime={at.toISOString()}>{at.toLocaleDateString("en-US", DATE)}</time>
        </a>
      </p>
    </article>
  );
}
