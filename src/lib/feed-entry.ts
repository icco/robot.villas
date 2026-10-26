/**
 * One post row in the public web UI (all lists use the same shape).
 */
export type FeedEntry = {
  id: number;
  botUsername: string;
  url: string;
  title: string;
  publishedAt: Date | null;
  likeCount: number;
  boostCount: number;
  hashtags: string[];
};

/**
 * Canonical URL for a Note. Must match the Note path in buildCreateActivity and
 * the federation object dispatcher.
 */
export function entryObjectUrl(domain: string, botUsername: string, id: number): string {
  return new URL(`/users/${botUsername}/posts/${id}`, `https://${domain}`).href;
}
