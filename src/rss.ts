import Parser from "rss-parser";

const parser = new Parser({ timeout: 10_000 });

export interface FeedEntry {
  guid: string;
  title: string;
  link: string;
  publishedAt: Date | null;
}

export async function fetchFeed(feedUrl: string): Promise<FeedEntry[]> {
  const feed = await parser.parseURL(feedUrl);
  return feed.items.map(normalizeFeedItem);
}

export async function parseFeedXml(xml: string): Promise<FeedEntry[]> {
  const feed = await parser.parseString(xml);
  return feed.items.map(normalizeFeedItem);
}

function normalizeFeedItem(item: Parser.Item): FeedEntry {
  // rss-parser maps RSS <guid> to item.guid and Atom <id> to item.id
  const raw = item as Record<string, unknown>;
  const guid = item.guid || (raw.id as string | undefined) || item.link || item.title || "";
  const title = item.title || "(untitled)";
  const link = item.link || "";
  const publishedAt = item.isoDate ? new Date(item.isoDate) : null;
  return { guid, title, link, publishedAt };
}
