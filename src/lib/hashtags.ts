import { GoogleGenAI } from "@google/genai";
import { getLogger } from "@logtape/logtape";
import type { BotConfig } from "./config";
import type { FeedEntry } from "./rss";

const logger = getLogger(["robot-villas", "hashtags"]);

/** Max hashtags per note (stored and rendered). */
export const MAX_TAGS = 3;
const MAX_TAG_LEN = 30;
const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

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
    `You are an experienced social-media content strategist. ` +
    `Given the JSON below describing a Fediverse mirroring bot and one RSS/Atom item, suggest exactly ${need} distinct hashtags.\n\n` +
    `Strategy:\n` +
    `- Analyze the entry title, categories, and bot summary to identify key themes, topics, and sentiments.\n` +
    `- Curate tags that are varied in popularity: mix broadly trending tags (high reach) with specific niche tags (targeted engagement) so the post is discoverable by both large and focused audiences.\n` +
    `- Align tags with the bot's identity and typical content (feed URL, display name, summary, default hashtags) to fit its overall social-media strategy.\n\n` +
    `Format rules:\n` +
    `- Each tag MUST be a single common word or well-known short compound (e.g. "Tech", "OpenSource", "Science", "Music").\n` +
    `- Maximum 30 characters per tag. Prefer tags under 15 characters.\n` +
    `- ASCII letters, digits, underscore only; CamelCase; no # or spaces inside a tag.\n` +
    `- Use recognizable topic tags, NOT article-specific phrases or proper nouns from the title.\n\n` +
    `${JSON.stringify(context, null, 2)}\n\n` +
    `Respond with JSON only: {"tags":["Tag",...]} with exactly ${need} strings.`;

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      maxOutputTokens: 128,
      temperature: 0.3,
      responseMimeType: "application/json",
    },
  });

  const text = response.text;
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
