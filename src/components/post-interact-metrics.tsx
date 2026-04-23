"use client";

import { ArrowPathRoundedSquareIcon, HeartIcon } from "@heroicons/react/24/outline";
import { InteractButton } from "@/app/bot/[username]/mastodon-widgets";

type Props = {
  /** Fedify object URI for the Note (e.g. https://domain/users/bot/posts/42) */
  activityUri: string;
  boostCount: number;
  likeCount: number;
  size?: "sm" | "md";
};

/**
 * Boost / favorite controls for feed entries, same on profile, all-posts, tags, and stats.
 * Opens the instance picker and deep-links to authorize against this post’s ActivityPub URI.
 */
export function PostInteractMetrics({
  activityUri,
  boostCount,
  likeCount,
  size = "md",
}: Props) {
  const icon = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  return (
    <>
      <InteractButton uri={activityUri}>
        <button
          type="button"
          title="Boost"
          className="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-info"
        >
          <ArrowPathRoundedSquareIcon className={icon} /> {boostCount}
        </button>
      </InteractButton>
      <InteractButton uri={activityUri}>
        <button
          type="button"
          title="Favorite"
          className="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-error"
        >
          <HeartIcon className={icon} /> {likeCount}
        </button>
      </InteractButton>
    </>
  );
}
