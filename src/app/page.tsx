import type { Metadata } from "next";
import Link from "next/link";
import { CpuChipIcon } from "@heroicons/react/24/solid";
import { getGlobals } from "@/lib/globals";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const { domain } = getGlobals();
  return {
    title: `${domain} – RSS-to-Mastodon Bridge`,
    description:
      "A collection of bot accounts mirroring public RSS and Atom feeds on the Fediverse.",
    openGraph: {
      title: `${domain} – RSS-to-Mastodon Bridge`,
      description:
        "A collection of bot accounts mirroring public RSS and Atom feeds on the Fediverse.",
      url: `https://${domain}/`,
    },
  };
}

export default function HomePage() {
  const { config, domain } = getGlobals();

  const sortedBots = Object.entries(config.bots).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <>
      <div className="mb-8">
        <h1 className="text-4xl font-display font-bold tracking-tight mb-4">
          {domain}
        </h1>
        <p className="text-base-content/80 text-lg leading-relaxed max-w-2xl">
          An <strong className="font-semibold">RSS-to-Mastodon bridge</strong>.
          A collection of bot accounts, each mirroring a public RSS or Atom
          feed. Follow your favorite blogs, news sites, and newsletters from
          Mastodon or any ActivityPub-compatible server.
        </p>
      </div>

      <div className="card bg-base-200 mb-8">
        <div className="card-body">
          <h3 className="card-title font-display text-lg">How it works</h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-base-content/80">
            <li>Pick a bot from the list below.</li>
            <li>
              Search for its handle (e.g.{" "}
              <code className="bg-base-300 px-1.5 py-0.5 rounded font-mono text-xs">
                @hackernews@{domain}
              </code>
              ) on your Mastodon instance, or click &quot;Follow on
              Mastodon&quot; on its profile page.
            </li>
            <li>
              New items from the RSS feed will appear in your home timeline.
            </li>
          </ol>
        </div>
      </div>

      <h2 className="text-2xl font-display font-bold mb-4">Bots</h2>
      <div className="divide-y divide-base-300">
        {sortedBots.map(([username, bot]) => (
          <Link
            key={username}
            href={`/@${username}`}
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-base-200 transition-colors group"
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
            <div className="min-w-0">
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
    </>
  );
}
