import Link from "next/link";
import { type FeedEntry, entryObjectUrl } from "@/lib/feed-entry";
import { hashtagClassNames } from "@/lib/hashtag-classnames";
import { EntryInteractButtons } from "./entry-interact-buttons";

const DATE: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

type PostFeedProps = {
  domain: string;
  entries: FeedEntry[];
  /** On /tags/[tag], highlight links for this tag */
  tagHighlight?: string;
  /** Shown as a single list row when `entries` is empty */
  emptyMessage?: string;
  /**
   * Set false on a bot profile: the @handle is already in the page header.
   * @default true
   */
  showBotHandle?: boolean;
};

/**
 * One shared post list: (optional @bot), title, hashtags, boost/favorite, date.
 */
export function PostFeed({
  domain,
  entries,
  tagHighlight,
  emptyMessage,
  showBotHandle = true,
}: PostFeedProps) {
  if (entries.length === 0) {
    if (emptyMessage) {
      return (
        <ul className="divide-y divide-base-300">
          <li className="py-4 text-base-content/50 italic">{emptyMessage}</li>
        </ul>
      );
    }
    return <ul className="divide-y divide-base-300" />;
  }

  const h = tagHighlight?.toLowerCase();

  return (
    <ul className="divide-y divide-base-300">
      {entries.map((e) => (
        <li
          key={e.id}
          className="flex items-baseline justify-between gap-4 py-2"
        >
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            {showBotHandle && (
              <Link
                href={`/@${e.botUsername}`}
                className="shrink-0 font-mono text-xs text-base-content/50"
              >
                @{e.botUsername}
              </Link>
            )}
            {e.url ? (
              <a href={e.url} className="link link-hover font-medium">
                {e.title}
              </a>
            ) : (
              <span className="font-medium">{e.title}</span>
            )}
            {e.hashtags.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {e.hashtags.map((t) => (
                  <Link
                    key={t}
                    href={`/tags/${encodeURIComponent(t.toLowerCase())}`}
                    className={
                      h === t.toLowerCase()
                        ? hashtagClassNames.linkActive
                        : hashtagClassNames.link
                    }
                  >
                    #{t}
                  </Link>
                ))}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <EntryInteractButtons
              activityUri={entryObjectUrl(domain, e.botUsername, e.id)}
              boostCount={e.boostCount}
              likeCount={e.likeCount}
            />
            {e.publishedAt && (
              <time
                dateTime={e.publishedAt.toISOString()}
                className="whitespace-nowrap text-xs text-base-content/50"
              >
                {e.publishedAt.toLocaleDateString("en-US", DATE)}
              </time>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
