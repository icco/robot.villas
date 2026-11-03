import type { PostReaction } from "@/lib/webmentions";

export function ReactorList({ title, reactors }: { title: string; reactors: PostReaction[] }) {
  if (reactors.length === 0) {
    return null;
  }
  return (
    <section className="mt-8">
      <h2 className="text-sm font-bold text-base-content/70 mb-2">{title}</h2>
      <ul className="flex flex-wrap gap-2">
        {reactors.map((r) => (
          <li key={r.profileUrl}>
            <a href={r.profileUrl} rel="nofollow ugc" className="flex items-center gap-2 rounded-full bg-base-200 hover:bg-base-300 pl-1 pr-3 py-1 text-sm">
              {r.iconUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={r.iconUrl} alt="" width={24} height={24} className="w-6 h-6 rounded-full object-cover" />
              ) : (
                <span className="w-6 h-6 rounded-full bg-base-300" />
              )}
              <span className="max-w-48 truncate">{r.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
