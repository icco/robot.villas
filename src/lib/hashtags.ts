import { getLogger } from "@logtape/logtape";
import type { BotConfig } from "./config";
import type { FeedEntry } from "./rss";

const logger = getLogger(["robot-villas", "hashtags"]);

/** Max hashtags per note (stored and rendered). */
export const MAX_TAGS = 3;
const MAX_TAG_LEN = 80;
const GEMINI_DEFAULT_MODEL = "gemini-2.0-flash-lite";

/**
 * Normalizes a candidate label to a Mastodon-safe hashtag token (no leading #).
 */
export function normalizeHashtagLabel(raw: string): string | null {
  let s = raw.trim().replace(/^#+/u, "");
  if (!s) {
    return null;
  }
  s = s.normalize("NFKD").replace(/\p{M}/gu, "");
  s = s.replace(/[^a-zA-Z0-9_]/g, "");
  if (!s) {
    return null;
  }
  if (s.length > MAX_TAG_LEN) {
    s = s.slice(0, MAX_TAG_LEN);
  }
  return s;
}

function dedupePush(pool: string[], next: string): void {
  const lower = next.toLowerCase();
  if (pool.some((t) => t.toLowerCase() === lower)) {
    return;
  }
  pool.push(next);
}

/**
 * Normalize and dedupe stored DB values only (legacy [] → no tags until backfill).
 */
export function hashtagsForNoteBody(stored: string[]): string[] {
  const pool: string[] = [];
  for (const s of stored) {
    const n = normalizeHashtagLabel(s);
    if (n) {
      dedupePush(pool, n);
    }
    if (pool.length >= MAX_TAGS) {
      break;
    }
  }
  return pool;
}

/**
 * Normalize and dedupe raw strings (feed categories + config defaults), capped at `max`.
 */
export function mergeHashtagCandidates(rawStrings: string[], max = MAX_TAGS): string[] {
  const pool: string[] = [];
  for (const s of rawStrings) {
    const n = normalizeHashtagLabel(s);
    if (n) {
      dedupePush(pool, n);
    }
    if (pool.length >= max) {
      return pool.slice(0, max);
    }
  }
  return pool.slice(0, max);
}

function parseGeminiTagsJson(text: string): string[] {
  const trim = text.trim();
  const tryParse = (s: string): string[] => {
    const data = JSON.parse(s) as { tags?: unknown };
    if (!Array.isArray(data.tags)) {
      throw new Error("missing tags array");
    }
    return data.tags.filter((x): x is string => typeof x === "string");
  };
  try {
    return tryParse(trim);
  } catch {
    return tryParse(trim.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/u, ""));
  }
}

async function geminiSuggestMissingTags(params: {
  need: number;
  apiKey: string;
  model: string;
  botUsername: string;
  bot: BotConfig;
  entry: FeedEntry;
}): Promise<string[]> {
  const { need, apiKey, model, botUsername, bot, entry } = params;
  if (need <= 0) {
    return [];
  }

  const context = {
    bot_username: botUsername,
    bot: {
      feed_url: bot.feed_url,
      display_name: bot.display_name,
      summary: bot.summary,
      default_hashtags: bot.default_hashtags ?? [],
    },
    entry: {
      guid: entry.guid,
      title: entry.title,
      link: entry.link,
      published_at: entry.publishedAt instanceof Date && !Number.isNaN(entry.publishedAt.getTime())
        ? entry.publishedAt.toISOString()
        : null,
      categories: entry.feedCategories,
    },
  };

  const prompt =
    `Given this JSON describing a Fediverse mirroring bot and one RSS/Atom item, suggest exactly ${need} distinct short hashtags ` +
    `(ASCII letters, digits, underscore only; CamelCase or snake_case; no # or spaces inside a tag).\n\n` +
    `${JSON.stringify(context, null, 2)}\n\n` +
    `Respond with JSON only: {"tags":["TagOne",...]} with exactly ${need} strings.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 128,
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("empty Gemini response");
  }
  return parseGeminiTagsJson(text);
}

export interface ResolveHashtagsOptions {
  geminiApiKey?: string;
  geminiModel?: string;
}

/**
 * Up to MAX_TAGS labels: feed categories + config defaults, then optional Gemini. No title/URL heuristics.
 */
export async function resolveHashtags(
  entry: FeedEntry,
  botUsername: string,
  bot: BotConfig,
  opts: ResolveHashtagsOptions = {},
): Promise<string[]> {
  const raw = [...entry.feedCategories, ...(bot.default_hashtags ?? [])];
  const pool = mergeHashtagCandidates(raw, MAX_TAGS);
  const need = MAX_TAGS - pool.length;
  const apiKey = opts.geminiApiKey ?? process.env.GEMINI_API_KEY;
  const model = opts.geminiModel ?? process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL;

  if (need <= 0 || !apiKey) {
    return pool;
  }

  try {
    const more = await geminiSuggestMissingTags({
      need,
      apiKey,
      model,
      botUsername,
      bot,
      entry,
    });
    for (const t of more) {
      const n = normalizeHashtagLabel(t);
      if (n) {
        dedupePush(pool, n);
      }
      if (pool.length >= MAX_TAGS) {
        break;
      }
    }
  } catch (e) {
    logger.warn("Gemini hashtag fill failed: {error}", { error: e });
  }

  return pool.slice(0, MAX_TAGS);
}
