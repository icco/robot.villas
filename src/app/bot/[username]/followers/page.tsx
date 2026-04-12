import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getGlobals } from "@/lib/globals";
import { getFollowers } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ username: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const { config, domain } = getGlobals();
  const bot = config.bots[username];
  if (!bot) {
    return {};
  }
  return {
    title: `Followers — ${bot.display_name} (@${username})`,
    description: `Accounts following @${username}@${domain} via ActivityPub.`,
    alternates: {
      canonical: `https://${domain}/@${username}/followers`,
    },
  };
}

export default async function BotFollowersPage({ params }: Props) {
  const { username } = await params;
  const { config, domain, db } = getGlobals();
  const bot = config.bots[username];
  if (!bot) {
    notFound();
  }
  const followers = (await getFollowers(db, username)).slice().sort();

  return (
    <>
      <Link href={`/@${username}`} className="btn btn-ghost btn-sm gap-1 mb-6 -ml-2">
        <span>&larr;</span> @{username}
      </Link>
      <h1 className="text-2xl font-display font-bold tracking-tight mb-2">Followers</h1>
      <p className="text-base-content/60 text-sm mb-6">
        <span className="font-mono">@{username}@{domain}</span>
        {" · "}
        <a
          href={`https://${domain}/users/${username}/followers`}
          className="link link-hover"
          target="_blank"
          rel="noopener noreferrer"
        >
          ActivityPub collection
        </a>
      </p>
      <ul className="space-y-2">
        {followers.length === 0 ? (
          <li className="text-base-content/50 text-sm">No followers yet.</li>
        ) : (
          followers.map((id) => (
            <li key={id}>
              <a
                href={id}
                className="link link-hover font-mono text-xs break-all"
                target="_blank"
                rel="noopener noreferrer"
              >
                {id}
              </a>
            </li>
          ))
        )}
      </ul>
    </>
  );
}
