import Link from "next/link";
import { CpuChipIcon } from "@heroicons/react/24/solid";
import type { BotConfig } from "@/lib/config";

export function BotList({ bots }: { bots: [string, BotConfig][] }) {
  return (
    <div className="divide-y divide-base-300">
      {bots.map(([username, bot]) => (
        <Link
          key={username}
          href={`/@${username}`}
          className="flex items-center gap-3 px-1 py-3 sm:p-3 rounded-lg hover:bg-base-200 transition-colors group"
        >
          {bot.profile_photo ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={bot.profile_photo}
              alt=""
              width={24}
              height={24}
              className="rounded-full"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-base-300 flex items-center justify-center">
              <CpuChipIcon className="w-4 h-4 text-base-content/50" />
            </div>
          )}
          <div className="min-w-0 break-words">
            <span className="font-mono text-sm font-semibold group-hover:text-primary transition-colors">
              @{username}
            </span>
            <span className="text-base-content/60 mx-1">&ndash;</span>
            <span className="font-medium">{bot.display_name}</span>
            <p className="text-xs text-base-content/50 truncate">
              {bot.summary}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
