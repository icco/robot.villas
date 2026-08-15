import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getGlobals } from "@/lib/globals";
import { FEED_USER_AGENT } from "@/lib/rss";

export const dynamic = "force-dynamic";

const REPO = "https://github.com/icco/robot.villas";
const EDIT_FEEDS_URL = `${REPO}/edit/main/feeds.yml`;

const DESCRIPTION =
  "What robot.villas is, how to add a feed, and how its RSS fetcher behaves.";

export function generateMetadata(): Metadata {
  const { domain } = getGlobals();
  return {
    title: "About",
    description: DESCRIPTION,
    alternates: { canonical: `https://${domain}/about` },
    openGraph: { title: `About – ${domain}`, description: DESCRIPTION, url: `https://${domain}/about` },
  };
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="bg-base-300 px-1.5 py-0.5 rounded font-mono text-xs break-all">
      {children}
    </code>
  );
}

export default function AboutPage() {
  const { config, domain } = getGlobals();
  const botCount = Object.keys(config.bots).length;

  return (
    <>
      <h1 className="text-4xl font-display font-bold tracking-tight mb-4">About</h1>
      <p className="text-base-content/80 text-lg leading-relaxed max-w-2xl mb-10">
        {domain} mirrors {botCount} public RSS and Atom feeds onto the Fediverse. Each feed gets its
        own bot account (<Code>@hackernews@{domain}</Code>) that posts new items, so you can follow a
        blog from Mastodon or any ActivityPub server. It is open source and run for free by{" "}
        <a href="https://natwelch.com" className="link link-primary">Nat Welch</a>.
      </p>

      <section className="mb-10">
        <h2 className="text-2xl font-display font-bold mb-3">Adding a feed</h2>
        <p className="text-base-content/80 mb-4">
          Every bot is one entry in <Code>feeds.yml</Code>. Suggest a feed by opening a pull request
          — or an <a href={`${REPO}/issues/new`} className="link link-primary">issue</a> with the URL
          if you would rather not.
        </p>
        <ol className="list-decimal list-outside ml-5 space-y-3 text-base-content/80">
          <li>
            <a href={EDIT_FEEDS_URL} className="link link-primary">Edit <Code>feeds.yml</Code></a> and
            add a block under <Code>bots:</Code>:
            <pre className="bg-base-200 rounded-lg p-4 mt-2 overflow-x-auto text-xs font-mono">
              {`  example_blog:
    feed_url: https://example.com/feed.xml
    display_name: Example Blog
    summary: What the blog is about.
    profile_photo: https://example.com/avatar.png  # optional
    default_hashtags: [Electronics, Retrocomputing]  # optional, max 3`}
            </pre>
          </li>
          <li>
            The key becomes the handle, so it must be lowercase letters, numbers, or underscores.
            <Code>display_name</Code> is capped at 100 characters and <Code>summary</Code> at 500.
          </li>
          <li>
            Run <Code>pnpm validate-feeds</Code> to check the schema and that any{" "}
            <Code>profile_photo</Code> is a reachable image. CI runs it too.
          </li>
          <li>Open the pull request. The bot goes live the next time the server deploys.</li>
        </ol>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-display font-bold mb-3">Removing a feed</h2>
        <p className="text-base-content/80">
          If you publish a feed here and would rather not, delete its entry in a pull request or open
          an issue and it will be removed. The bot account is deleted and its posts are withdrawn
          from the Fediverse.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-display font-bold mb-3">How the fetcher behaves</h2>
        <p className="text-base-content/80 mb-4">
          If you run a site listed on the <a href="/status" className="link link-primary">status page</a>,
          this is what you will see in your logs:
        </p>
        <ul className="list-disc list-outside ml-5 space-y-2 text-base-content/80">
          <li>
            It identifies itself as <Code>{FEED_USER_AGENT}</Code>.
          </li>
          <li>Each feed is fetched at most once every 15 minutes.</li>
          <li>
            Requests are conditional (<Code>If-None-Match</Code> / <Code>If-Modified-Since</Code>),
            so an unchanged feed costs you a 304 and no body.
          </li>
          <li>
            A <Code>429</Code> pauses that feed until its <Code>Retry-After</Code> has passed.
          </li>
          <li>Only titles and links are reposted, each crediting your feed with a link back.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-display font-bold mb-3">Source</h2>
        <p className="text-base-content/80">
          <a href={REPO} className="link link-primary">github.com/icco/robot.villas</a> — bug reports
          and feed suggestions welcome.
        </p>
      </section>
    </>
  );
}
