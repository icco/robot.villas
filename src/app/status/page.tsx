import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
  MinusCircleIcon,
} from "@heroicons/react/24/outline";
import { getGlobals } from "@/lib/globals";
import { getRelayStatusSummary, getFollowingStatusSummary } from "@/lib/db";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const { domain } = getGlobals();
  return {
    title: "Status",
    description: `Subscription and feed status for ${domain}.`,
    alternates: {
      canonical: `https://${domain}/status`,
    },
  };
}

function StatusBadge({ status }: { status: "accepted" | "pending" | "rejected" | "none" }) {
  if (status === "accepted") {
    return (
      <span className="inline-flex items-center gap-1 text-success text-xs font-medium">
        <CheckCircleIcon className="w-3.5 h-3.5" /> accepted
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-warning text-xs font-medium">
        <ClockIcon className="w-3.5 h-3.5" /> pending
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 text-error text-xs font-medium">
        <ExclamationCircleIcon className="w-3.5 h-3.5" /> rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-base-content/40 text-xs font-medium">
      <MinusCircleIcon className="w-3.5 h-3.5" /> none
    </span>
  );
}

/** Renders a status badge + count, or a "none" badge when count is 0. */
function StatusCell({ count, type }: { count: number; type: "accepted" | "pending" | "rejected" }) {
  if (count > 0) {
    return (
      <>
        <StatusBadge status={type} />
        <span className="ml-1 text-xs">{count}</span>
      </>
    );
  }
  return <StatusBadge status="none" />;
}

export default async function StatusPage() {
  const { config, db } = getGlobals();
  const botCount = Object.keys(config.bots).length;
  const [relaySummary, followingSummary] = await Promise.all([
    getRelayStatusSummary(db),
    getFollowingStatusSummary(db),
  ]);

  const configuredRelays = config.relays ?? [];
  const configuredFollows = (config.follows ?? []).map((h) => h.replace(/^@/, ""));

  // Build lookup maps for quick access
  const relayMap = new Map(relaySummary.map((r) => [r.url, r]));
  const followMap = new Map(followingSummary.map((f) => [f.handle, f]));

  return (
    <>
      <Link href="/" className="btn btn-ghost btn-sm gap-1 mb-6 -ml-2">
        <span>&larr;</span> All bots
      </Link>
      <h1 className="text-3xl font-display font-bold tracking-tight mb-2">Status</h1>
      <p className="text-base-content/60 text-sm mb-8">
        Live view of relay subscriptions, account follows, and configured RSS feeds.
      </p>

      {/* Relay Subscriptions */}
      <section className="mb-10">
        <h2 className="text-xl font-display font-bold mb-3">Relay Subscriptions</h2>
        {configuredRelays.length === 0 ? (
          <p className="text-base-content/50 text-sm">No relays configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm w-full">
              <thead>
                <tr>
                  <th>Relay URL</th>
                  <th className="text-right">Bots / Total</th>
                  <th className="text-right">Accepted</th>
                  <th className="text-right">Pending</th>
                  <th className="text-right">Rejected</th>
                </tr>
              </thead>
              <tbody>
                {configuredRelays.map((url) => {
                  const s = relayMap.get(url);
                  const total = s ? s.accepted + s.pending + s.rejected : 0;
                  const allAccepted = s && s.accepted === botCount;
                  return (
                    <tr key={url} className={allAccepted ? "text-success" : ""}>
                      <td className="font-mono text-xs break-all">{url}</td>
                      <td className="text-right">
                        <span className={total < botCount ? "text-warning font-semibold" : ""}>{total} / {botCount}</span>
                      </td>
                      <td className="text-right"><StatusCell count={s?.accepted ?? 0} type="accepted" /></td>
                      <td className="text-right"><StatusCell count={s?.pending ?? 0} type="pending" /></td>
                      <td className="text-right"><StatusCell count={s?.rejected ?? 0} type="rejected" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Account Follows */}
      <section className="mb-10">
        <h2 className="text-xl font-display font-bold mb-3">Account Follows</h2>
        {configuredFollows.length === 0 ? (
          <p className="text-base-content/50 text-sm">No accounts configured to follow.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm w-full">
              <thead>
                <tr>
                  <th>Handle</th>
                  <th className="text-right">Bots / Total</th>
                  <th className="text-right">Accepted</th>
                  <th className="text-right">Pending</th>
                  <th className="text-right">Rejected</th>
                </tr>
              </thead>
              <tbody>
                {configuredFollows.map((handle) => {
                  const s = followMap.get(handle);
                  const total = s ? s.accepted + s.pending + s.rejected : 0;
                  const allAccepted = s && s.accepted === botCount;
                  return (
                    <tr key={handle} className={allAccepted ? "text-success" : ""}>
                      <td className="font-mono text-xs">@{handle}</td>
                      <td className="text-right">
                        <span className={total < botCount ? "text-warning font-semibold" : ""}>{total} / {botCount}</span>
                      </td>
                      <td className="text-right"><StatusCell count={s?.accepted ?? 0} type="accepted" /></td>
                      <td className="text-right"><StatusCell count={s?.pending ?? 0} type="pending" /></td>
                      <td className="text-right"><StatusCell count={s?.rejected ?? 0} type="rejected" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* RSS Feed Info */}
      <section>
        <h2 className="text-xl font-display font-bold mb-3">RSS Feeds</h2>
        <div className="overflow-x-auto">
          <table className="table table-sm w-full">
            <thead>
              <tr>
                <th>Bot</th>
                <th className="hidden sm:table-cell">Name</th>
                <th>Feed URL</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(config.bots)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([username, bot]) => (
                  <tr key={username}>
                    <td>
                      <Link
                        href={`/@${username}`}
                        className="link link-hover font-mono text-xs"
                      >
                        @{username}
                      </Link>
                    </td>
                    <td className="hidden sm:table-cell text-sm">{bot.display_name}</td>
                    <td>
                      <a
                        href={bot.feed_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link link-hover font-mono text-xs break-all"
                      >
                        {bot.feed_url}
                      </a>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
