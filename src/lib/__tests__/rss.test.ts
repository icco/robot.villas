import { describe, it, expect } from "vitest";
import { MAX_ITEMS_PER_POLL, parseFeedXml, type FeedEntry } from "../rss";

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    <description>A test feed</description>
    <item>
      <title>First Post</title>
      <link>https://example.com/first</link>
      <guid>guid-1</guid>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Second Post</title>
      <link>https://example.com/second</link>
      <guid>guid-2</guid>
      <pubDate>Tue, 02 Jan 2024 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <link href="https://example.com"/>
  <entry>
    <title>Atom Entry</title>
    <link href="https://example.com/atom-entry"/>
    <id>urn:uuid:atom-1</id>
    <updated>2024-01-15T10:00:00Z</updated>
  </entry>
</feed>`;

const MINIMAL_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Minimal</title>
    <item>
      <title>No link or guid</title>
    </item>
  </channel>
</rss>`;

describe("parseFeedXml", () => {
  it("parses RSS 2.0 items", async () => {
    const entries = await parseFeedXml(SAMPLE_RSS);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      guid: "guid-1",
      title: "First Post",
      link: "https://example.com/first",
    });
    expect(entries[0].publishedAt).toBeInstanceOf(Date);
    expect(entries[1].guid).toBe("guid-2");
  });

  it("parses Atom feeds", async () => {
    const entries = await parseFeedXml(ATOM_FEED);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      guid: "urn:uuid:atom-1",
      title: "Atom Entry",
      link: "https://example.com/atom-entry",
    });
    expect(entries[0].publishedAt).toBeInstanceOf(Date);
  });

  it("handles items with missing fields gracefully", async () => {
    const entries = await parseFeedXml(MINIMAL_RSS);
    expect(entries).toHaveLength(1);
    const entry = entries[0] as FeedEntry;
    expect(entry.title).toBe("No link or guid");
    expect(entry.guid).toBe("No link or guid");
    expect(entry.link).toBe("");
    expect(entry.publishedAt).toBeNull();
  });

  it("returns empty array for empty feed", async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>Empty</title></channel></rss>`;
    const entries = await parseFeedXml(xml);
    expect(entries).toEqual([]);
  });

  it("caps items at MAX_ITEMS_PER_POLL", async () => {
    const item = (i: number) =>
      `<item><title>Item ${i}</title><link>https://example.com/${i}</link><guid>g-${i}</guid></item>`;
    const many = Array.from({ length: MAX_ITEMS_PER_POLL + 10 }, (_, i) => item(i)).join("");
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Big</title>${many}</channel></rss>`;
    const entries = await parseFeedXml(xml);
    expect(entries).toHaveLength(MAX_ITEMS_PER_POLL);
    expect(entries[0]?.title).toBe("Item 0");
    expect(entries[MAX_ITEMS_PER_POLL - 1]?.title).toBe(`Item ${MAX_ITEMS_PER_POLL - 1}`);
  });
});
