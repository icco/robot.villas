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
 * Canonical URL for a Note in this app, identical to
 * `new URL(\`/users/…/posts/…\`, origin)` in {@link import("./publisher").buildCreateActivity}
 * and the Fedify object path `/users/{identifier}/posts/{id}` in federation.
 */
export function entryObjectUrl(domain: string, botUsername: string, id: number): string {
  return new URL(`/users/${botUsername}/posts/${id}`, `https://${domain}`).href;
}
