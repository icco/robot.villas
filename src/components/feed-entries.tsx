import { Fragment } from "react";
import Link from "next/link";
import { type FeedEntry, entryObjectUrl } from "@/lib/feed-entry";
import { EntryInteractButtons } from "./entry-interact-buttons";

const DATE: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

type PostFeedProps = {
  domain: string;
  entries: FeedEntry[];
  tagHighlight?: string;
  emptyMessage?: string;
  showBotHandle?: boolean;
};

/**
 * One shared post list: (optional @bot), title, hashtags, boost/favorite, date — all inline.
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
          <li className="py-3 text-base-content/50 italic">{emptyMessage}</li>
        </ul>
      );
    }
    return <ul className="divide-y divide-base-300" />;
  }

  return (
    <ul className="divide-y divide-base-300">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <p className="text-sm leading-relaxed min-w-0 break-words">
            {showBotHandle && (
              <>
                <Link
                  href={`/@${e.botUsername}`}
                  className="font-mono text-xs text-base-content/50 hover:text-base-content/80 mr-1"
                >
                  @{e.botUsername}
                </Link>{" "}
              </>
            )}
            {e.url ? (
              <a href={e.url} className="link link-hover font-medium">
                {e.title}
              </a>
            ) : (
              <span className="font-medium">{e.title}</span>
            )}
            {e.hashtags.length > 0 && (
              <>
                {" "}
                {e.hashtags.map((t) => (
                  <Fragment key={t}>
                    <Link
                      href={`/tags/${encodeURIComponent(t.toLowerCase())}`}
                      className={`link link-hover text-xs font-mono text-primary/70 hover:text-primary transition-colors${tagHighlight?.toLowerCase() === t.toLowerCase() ? " font-bold" : ""}`}
                    >
                      #{t}
                    </Link>{" "}
                  </Fragment>
                ))}
              </>
            )}
          </p>
          <span className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
            <EntryInteractButtons
              activityUri={entryObjectUrl(domain, e.botUsername, e.id)}
              boostCount={e.boostCount}
              likeCount={e.likeCount}
            />
            {e.publishedAt && (
              <time
                dateTime={e.publishedAt.toISOString()}
                className="text-xs text-base-content/40 whitespace-nowrap"
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
