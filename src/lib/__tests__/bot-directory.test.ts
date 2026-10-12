import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BotConfig } from "../config";
import HomePage from "@/app/page";

const { bots } = vi.hoisted(() => ({
  bots: Object.fromEntries(
    Array.from({ length: 25 }, (_, index) => {
      const suffix = String(24 - index).padStart(2, "0");
      return [`alice_${suffix}`, {
        display_name: `Ada Lovelace ${suffix}`,
        summary: "Science & tech updates",
      }];
    }),
  ) as Record<string, BotConfig>,
}));

vi.mock("@/lib/globals", () => ({
  getGlobals: () => ({ config: { bots }, domain: "robot.example" }),
}));

function profileLinks(html: string): string[] {
  return Array.from(html.matchAll(/href="(\/@[^"]+)"/g), (match) => match[1]);
}

async function searchPage(params: { q?: string | string[]; page?: string | string[] } = {}) {
  const { default: SearchPage } = await import("@/app/search/page");
  return renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve(params) }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("homepage bot discovery", () => {
  it("shows ten distinct bots and links to the full search", () => {
    const html = renderToStaticMarkup(createElement(HomePage));
    const links = profileLinks(html);
    expect(links).toHaveLength(10);
    expect(new Set(links).size).toBe(10);
    expect(links.every((link) => link.slice(2) in bots)).toBe(true);
    expect(html).toContain('href="/search"');
  });

  it("uses randomness rather than always showing the same ten bots", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const first = profileLinks(renderToStaticMarkup(createElement(HomePage)));
    random.mockReturnValue(0.999);
    const second = profileLinks(renderToStaticMarkup(createElement(HomePage)));
    expect(first).not.toEqual(second);
  });
});

describe("bot search", () => {
  it("lists the first twenty bots alphabetically when no query is provided", async () => {
    const html = await searchPage();
    const links = profileLinks(html);
    expect(links).toHaveLength(20);
    expect(links[0]).toBe("/@alice_00");
    expect(links[19]).toBe("/@alice_19");
    expect(html).toContain('href="/search?q=&amp;page=1"');
    expect(html).not.toContain("Previous");
  });

  it.each([
    ["  @ALICE_07  ", ["/@alice_07"]],
    ["LOVELACE 08", ["/@alice_08"]],
    ["science & TECH", 20],
  ])("matches handles, names, or summaries for %s", async (query, expected) => {
    const links = profileLinks(await searchPage({ q: query }));
    if (typeof expected === "number") {
      expect(links).toHaveLength(expected);
    } else {
      expect(links).toEqual(expected);
    }
  });

  it("preserves the encoded query when navigating between pages", async () => {
    const first = await searchPage({ q: "science & tech" });
    const second = await searchPage({ q: "science & tech", page: "1" });
    expect(first).toContain('href="/search?q=science+%26+tech&amp;page=1"');
    expect(second).toContain('href="/search?q=science+%26+tech&amp;page=0"');
    expect(profileLinks(second)).toEqual([
      "/@alice_20", "/@alice_21", "/@alice_22", "/@alice_23", "/@alice_24",
    ]);
    expect(second).not.toContain(">Next");
  });

  it("submits a new query without retaining the previous page", async () => {
    const html = await searchPage({ q: "tech", page: "1" });
    expect(html).toContain('action="/search"');
    expect(html).toContain('method="get"');
    expect(html).toContain('name="q"');
    expect(html).not.toContain('name="page"');
  });

  it("shows an empty state when no bots match", async () => {
    const html = await searchPage({ q: "no such bot" });
    expect(profileLinks(html)).toEqual([]);
    expect(html).toContain("No bots found");
    expect(html).not.toContain("Next");
    expect(html).not.toContain("Previous");
  });

  it.each(["-1", "not-a-page"])("falls back to the first page for %s", async (page) => {
    const links = profileLinks(await searchPage({ page }));
    expect(links).toHaveLength(20);
    expect(links[0]).toBe("/@alice_00");
  });

  it("clamps an out-of-range page to the last results page", async () => {
    const html = await searchPage({ page: "999" });
    expect(profileLinks(html)).toHaveLength(5);
    expect(html).toContain('href="/search?q=&amp;page=0"');
  });

  it("handles repeated search parameters", async () => {
    expect(profileLinks(await searchPage({ q: ["alice_01", "alice_02"], page: ["0", "1"] })))
      .toEqual(["/@alice_01"]);
  });
});
