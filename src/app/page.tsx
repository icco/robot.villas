import type { Metadata } from "next";
import Link from "next/link";
import { BotList } from "@/components/bot-list";
import { getGlobals } from "@/lib/globals";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const { domain } = getGlobals();
  return {
    title: `${domain} – RSS-to-Mastodon Bridge`,
    description:
      "A collection of bot accounts mirroring public RSS and Atom feeds on the Fediverse.",
    alternates: {
      canonical: `https://${domain}/`,
    },
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

  const bots = Object.entries(config.bots);
  for (let i = bots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bots[i], bots[j]] = [bots[j], bots[i]];
  }

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
            <li>Pick a bot below or search the full directory.</li>
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

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-2xl font-display font-bold">Discover bots</h2>
        <Link href="/search" className="btn btn-sm btn-primary">
          Search all bots
        </Link>
      </div>
      <BotList bots={bots.slice(0, 10)} />
    </>
  );
}
