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

export function entryObjectUrl(domain: string, botUsername: string, id: number): string {
  return `https://${domain}/users/${botUsername}/posts/${id}`;
}
