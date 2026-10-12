import type { Metadata } from "next";
import Link from "next/link";
import { BotList } from "@/components/bot-list";
import { getGlobals } from "@/lib/globals";
import { parsePageParam } from "@/lib/pagination";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search Bots",
  description: "Find RSS and Atom feed bots to follow on the Fediverse.",
};

const PAGE_SIZE = 20;

interface Props {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}

export default async function SearchPage({ searchParams }: Props) {
  const { config, domain } = getGlobals();
  const params = await searchParams;
  const query = (Array.isArray(params.q) ? params.q[0] : params.q)?.trim() ?? "";
  const search = query.toLowerCase();
  const bots = Object.entries(config.bots)
    .filter(([username, bot]) =>
      [`@${username}@${domain}`, bot.display_name, bot.summary]
        .some((value) => value.toLowerCase().includes(search)),
    )
    .sort(([a], [b]) => a.localeCompare(b));
  const totalPages = Math.max(1, Math.ceil(bots.length / PAGE_SIZE));
  const page = Math.min(
    parsePageParam(Array.isArray(params.page) ? params.page[0] : params.page),
    totalPages - 1,
  );
  const offset = page * PAGE_SIZE;
  const pageBots = bots.slice(offset, offset + PAGE_SIZE);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-display font-bold tracking-tight">Search bots</h1>
        <p className="text-base-content/60 mt-1">
          Find a bot by handle, name, or description.
        </p>
      </div>

      <form action="/search" method="get" className="flex flex-wrap items-end gap-3 mb-6">
        <div className="flex-1 min-w-0">
          <label htmlFor="bot-search" className="block text-sm font-medium mb-2">
            Search bots
          </label>
          <input
            id="bot-search"
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Handle, name, or description"
            className="input input-bordered w-full"
          />
        </div>
        <button type="submit" className="btn btn-primary">Search</button>
      </form>

      <p className="text-sm text-base-content/60 mb-4">
        {bots.length === 0
          ? "0 bots"
          : `${offset + 1}-${offset + pageBots.length} of ${bots.length.toLocaleString("en-US")} bots`}
      </p>

      {bots.length === 0 ? (
        <p className="text-base-content/80">No bots found. Try another search.</p>
      ) : (
        <BotList bots={pageBots} />
      )}

      {totalPages > 1 && (
        <nav aria-label="Search results pages" className="flex flex-wrap items-center gap-3 mt-6">
          <div className="join">
            {page > 0 && (
              <Link
                href={`/search?${new URLSearchParams({ q: query, page: String(page - 1) })}`}
                className="join-item btn btn-sm"
              >
                Previous
              </Link>
            )}
            {page < totalPages - 1 && (
              <Link
                href={`/search?${new URLSearchParams({ q: query, page: String(page + 1) })}`}
                className="join-item btn btn-sm"
              >
                Next
              </Link>
            )}
          </div>
          <span className="text-sm text-base-content/60">Page {page + 1} of {totalPages}</span>
        </nav>
      )}
    </>
  );
}
