import { NextResponse } from "next/server";
import { getGlobals } from "@/lib/globals";
import { countEntriesForBots } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { config, db } = getGlobals();
  const botUsernames = Object.keys(config.bots);
  const localPosts = await countEntriesForBots(db, botUsernames);

  return NextResponse.json({
    version: "2.0",
    software: { name: "robot-villas", version: "1.0.0" },
    protocols: ["activitypub"],
    usage: {
      users: {
        total: botUsernames.length,
        activeMonth: botUsernames.length,
        activeHalfyear: botUsernames.length,
      },
      localPosts,
      localComments: 0,
    },
    openRegistrations: false,
  });
}
