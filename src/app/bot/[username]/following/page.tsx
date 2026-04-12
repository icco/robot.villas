import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getGlobals } from "@/lib/globals";
import { getFollowingListForBot } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ username: string }>;
}

function FollowStateLabel({ status }: { status: string }) {
  if (status === "accepted") {
    return <span className="text-success text-xs font-medium">accepted</span>;
  }
  if (status === "rejected") {
    return <span className="text-error text-xs font-medium">rejected</span>;
  }
  return <span className="text-warning text-xs font-medium">pending</span>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const { config, domain } = getGlobals();
  const bot = config.bots[username];
  if (!bot) {
    return {};
  }
  return {
    title: `Following — ${bot.display_name} (@${username})`,
    description: `Accounts @${username}@${domain} follows via ActivityPub.`,
    alternates: {
      canonical: `https://${domain}/@${username}/following`,
    },
  };
}

export default async function BotFollowingPage({ params }: Props) {
  const { username } = await params;
  const { config, domain, db } = getGlobals();
  const bot = config.bots[username];
  if (!bot) {
    notFound();
  }
  const following = await getFollowingListForBot(db, username);

  return (
    <>
      <Link href={`/@${username}`} className="btn btn-ghost btn-sm gap-1 mb-6 -ml-2">
        <span>&larr;</span> @{username}
      </Link>
      <h1 className="text-2xl font-display font-bold tracking-tight mb-2">Following</h1>
      <p className="text-base-content/60 text-sm mb-6">
        <span className="font-mono">@{username}@{domain}</span>
        {" · "}
        <a
          href={`https://${domain}/users/${username}/following`}
          className="link link-hover"
          target="_blank"
          rel="noopener noreferrer"
        >
          ActivityPub collection
        </a>
      </p>
      {following.length === 0 ? (
        <p className="text-base-content/50 text-sm">This bot is not following any accounts yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-sm w-full">
            <thead>
              <tr>
                <th>Handle</th>
                <th>Status</th>
                <th className="hidden sm:table-cell">Actor</th>
              </tr>
            </thead>
            <tbody>
              {following.map((row) => (
                <tr key={row.handle}>
                  <td className="font-mono text-xs">@{row.handle}</td>
                  <td>
                    <FollowStateLabel status={row.status} />
                  </td>
                  <td className="hidden sm:table-cell">
                    {row.targetActorId ? (
                      <a
                        href={row.targetActorId}
                        className="link link-hover font-mono text-xs break-all"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {row.targetActorId}
                      </a>
                    ) : (
                      <span className="text-base-content/40 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
