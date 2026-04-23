import Link from "next/link";
import type { ReactNode } from "react";

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

function PostPublishedAt({ at }: { at: Date | null | undefined }) {
  if (!at) {
    return null;
  }
  return (
    <time
      dateTime={at.toISOString()}
      className="text-xs text-base-content/50 whitespace-nowrap"
    >
      {at.toLocaleDateString("en-US", DATE_OPTS)}
    </time>
  );
}

type HashtagLinksProps = {
  tags: string[];
  /** If set, that tag is emphasized (tag detail page) */
  highlightTag?: string;
  tagClassName?: string;
  highlightClassName?: string;
};

export function PostHashtags({
  tags,
  highlightTag,
  tagClassName = "text-xs font-mono text-base-content/40 hover:text-primary/70",
  highlightClassName = "text-xs font-mono text-primary",
}: HashtagLinksProps) {
  if (tags.length === 0) {
    return null;
  }
  const h = highlightTag?.toLowerCase();
  return (
    <span className="flex gap-1 flex-wrap">
      {tags.map((t) => (
        <Link
          key={t}
          href={`/tags/${encodeURIComponent(t.toLowerCase())}`}
          className={h === t.toLowerCase() ? highlightClassName : tagClassName}
        >
          #{t}
        </Link>
      ))}
    </span>
  );
}

type PostListItemProps = {
  /** e.g. /@bot on /posts, /tags, or stats */
  showBotLink?: { username: string };
  title: string;
  href?: string | null;
  hashtags?: string[];
  tagHighlight?: string;
  /** Overrides for {@link PostHashtags} (e.g. bot profile vs /posts) */
  hashtagClassName?: string;
  highlightHashtagClassName?: string;
  publishedAt: Date | null;
  /** Use `PostInteractMetrics` (Mastodon picker) for boost/favorite. */
  metrics: ReactNode;
  extraLeading?: ReactNode;
};

/**
 * One row: primary column (optional @bot, title, hashtags) and trailing
 * (metrics + date). Use `PostInteractMetrics` for boost/favorite everywhere.
 */
export function PostListItem({
  showBotLink,
  title,
  href,
  hashtags = [],
  tagHighlight,
  hashtagClassName,
  highlightHashtagClassName,
  publishedAt,
  metrics,
  extraLeading,
}: PostListItemProps) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-2">
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
        {extraLeading}
        {showBotLink && (
          <Link
            href={`/@${showBotLink.username}`}
            className="text-xs text-base-content/50 font-mono shrink-0"
          >
            @{showBotLink.username}
          </Link>
        )}
        {href ? (
          <a href={href} className="link link-hover font-medium">
            {title}
          </a>
        ) : (
          <span className="font-medium">{title}</span>
        )}
        {hashtags.length > 0 && (
          <PostHashtags
            tags={hashtags}
            highlightTag={tagHighlight}
            tagClassName={hashtagClassName}
            highlightClassName={highlightHashtagClassName}
          />
        )}
      </span>
      <span className="flex items-center gap-1 shrink-0">
        {metrics}
        <PostPublishedAt at={publishedAt} />
      </span>
    </li>
  );
}

export function PostList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-base-300">{children}</ul>;
}

export { PostPublishedAt };
