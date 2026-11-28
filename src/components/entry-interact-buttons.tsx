"use client";

import { Heart, Repeat } from "lucide-react";
import { InteractButton } from "@/app/bot/[username]/mastodon-widgets";

type Props = {
  activityUri: string;
  boostCount: number;
  likeCount: number;
};

export function EntryInteractButtons({ activityUri, boostCount, likeCount }: Props) {
  return (
    <>
      <InteractButton uri={activityUri} action="boost">
        <button
          type="button"
          title="Boost from your server"
          aria-label={`Boost from your server (${boostCount} boosts)`}
          aria-haspopup="dialog"
          className="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-info"
        >
          <Repeat className="h-4 w-4" aria-hidden="true" /> {boostCount}
        </button>
      </InteractButton>
      <InteractButton uri={activityUri} action="favorite">
        <button
          type="button"
          title="Favorite from your server"
          aria-label={`Favorite from your server (${likeCount} favorites)`}
          aria-haspopup="dialog"
          className="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-error"
        >
          <Heart className="h-4 w-4" aria-hidden="true" /> {likeCount}
        </button>
      </InteractButton>
    </>
  );
}
