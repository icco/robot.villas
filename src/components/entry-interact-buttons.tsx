"use client";

import { ArrowPathRoundedSquareIcon, HeartIcon } from "@heroicons/react/24/outline";
import { InteractButton } from "@/app/bot/[username]/mastodon-widgets";

type Props = {
  activityUri: string;
  boostCount: number;
  likeCount: number;
};

export function EntryInteractButtons({ activityUri, boostCount, likeCount }: Props) {
  return (
    <>
      <InteractButton uri={activityUri}>
        <button
          type="button"
          title="Boost"
          className="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-info"
        >
          <ArrowPathRoundedSquareIcon className="h-4 w-4" /> {boostCount}
        </button>
      </InteractButton>
      <InteractButton uri={activityUri}>
        <button
          type="button"
          title="Favorite"
          className="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-error"
        >
          <HeartIcon className="h-4 w-4" /> {likeCount}
        </button>
      </InteractButton>
    </>
  );
}
