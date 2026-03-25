import { getLogger } from "@logtape/logtape";
import type { BotConfig } from "./config";
import type { FeedEntry } from "./rss";

const logger = getLogger(["robot-villas", "hashtags"]);

export const HASHTAG_COUNT = 3;
const MAX_TAG_LEN = 80;

const GEMINI_DEFAULT_MODEL = "gemini-2.0-flash-lite";

/**
 * Normalizes a candidate label to a Mastodon-safe hashtag token (no leading #).
 * Prefers ASCII letters, digits, and underscores; drops other characters.
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

function titleDerivedTags(title: string): string[] {
  const words = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-zA-Z0-9]+/g)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
  const out: string[] = [];
  for (const w of words) {
    const t =
      w.charAt(0).toUpperCase() +
      w
        .slice(1)
        .toLowerCase()
        .replace(/[^a-zA-Z0-9_]/g, "");
    const norm = normalizeHashtagLabel(t);
    if (norm) {
      out.push(norm);
    }
  }
  return out;
}

function hostnameDerivedTag(link: string): string | null {
  try {
    const host = new URL(link).hostname.replace(/^www\./i, "");
    const first = host.split(".")[0] ?? "";
    if (first.length < 2) {
      return null;
    }
    const t = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    return normalizeHashtagLabel(t);
  } catch {
    return null;
  }
}

export interface NoteHashtagContext {
  botUsername: string;
  title: string;
  link: string;
}

/**
 * Display hashtags from DB `hashtags` plus title/link heuristics (capped at HASHTAG_COUNT).
 * Legacy rows may be [] — may stay empty if nothing can be derived.
 */
export function coerceNoteHashtags(stored: string[], ctx: NoteHashtagContext): string[] {
  const pool: string[] = [];
  for (const s of stored) {
    const n = normalizeHashtagLabel(s);
    if (n) {
      dedupePush(pool, n);
    }
    if (pool.length >= HASHTAG_COUNT) {
      return pool.slice(0, HASHTAG_COUNT);
    }
  }
  for (const t of titleDerivedTags(ctx.title)) {
    dedupePush(pool, t);
    if (pool.length >= HASHTAG_COUNT) {
      return pool.slice(0, HASHTAG_COUNT);
    }
  }
  if (ctx.link) {
    const h = hostnameDerivedTag(ctx.link);
    if (h) {
      dedupePush(pool, h);
    }
  }
  return pool.slice(0, HASHTAG_COUNT);
}

interface GeminiTagsResponse {
  tags?: unknown;
}

function parseGeminiJson(text: string): string[] {
  const trimmed = text.trim();
  const data = JSON.parse(trimmed) as GeminiTagsResponse;
  if (!Array.isArray(data.tags)) {
    throw new Error("missing tags array");
  }
  return data.tags.filter((x): x is string => typeof x === "string");
}

function parseGeminiJsonLenient(text: string): string[] {
  try {
    return parseGeminiJson(text);
  } catch {
    const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/u, "");
    return parseGeminiJson(stripped);
  }
}

export interface GeminiHashtagContext {
  botUsername: string;
  bot: BotConfig;
  entry: FeedEntry;
}

function buildGeminiPrompt(need: number, ctx: GeminiHashtagContext): string {
  const { botUsername, bot, entry } = ctx;
  const published =
    entry.publishedAt instanceof Date && !Number.isNaN(entry.publishedAt.getTime())
      ? entry.publishedAt.toISOString()
      : "unknown";
  const categories =
    entry.feedCategories.length > 0 ? entry.feedCategories.join(", ") : "(none)";
  const defaults =
    bot.default_hashtags && bot.default_hashtags.length > 0
      ? bot.default_hashtags.join(", ")
      : "(none)";

  return [
    "You are tagging a Fediverse post that mirrors one RSS/Atom feed item.",
    "",
    "=== Feed item (all available fields) ===",
    `guid: ${entry.guid || "(empty)"}`,
    `title: ${entry.title}`,
    `link: ${entry.link || "(empty)"}`,
    `published_at: ${published}`,
    `categories / keywords from feed XML: ${categories}`,
    "",
    "=== Mirroring bot (this account) ===",
    `bot_username: ${botUsername}`,
    `source_feed_url: ${bot.feed_url}`,
    `display_name: ${bot.display_name}`,
    `summary: ${bot.summary}`,
    `configured_default_hashtags: ${defaults}`,
    "",
    `Suggest exactly ${need} distinct short hashtags that fit this item and bot context. `,
    "Each tag: ASCII letters, digits, underscores only (CamelCase or snake_case). ",
    "No # character. No spaces inside a tag.",
    "",
    `Respond with JSON only: {"tags":["TagOne",...]} with exactly ${need} strings.`,
  ].join("\n");
}

async function geminiFillTags(params: {
  apiKey: string;
  model: string;
  need: number;
  context: GeminiHashtagContext;
}): Promise<string[]> {
  const { apiKey, model, need, context } = params;
  if (need <= 0) {
    return [];
  }

  const prompt = buildGeminiPrompt(need, context);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 128,
      temperature: 0.3,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
  return parseGeminiJsonLenient(text);
}

async function tryGeminiFill(params: {
  apiKey: string;
  model: string;
  need: number;
  context: GeminiHashtagContext;
}): Promise<string[]> {
  try {
    const raw = await geminiFillTags(params);
    const normalized = raw
      .map((s) => normalizeHashtagLabel(s))
      .filter((s): s is string => s != null);
    return normalized.slice(0, params.need);
  } catch (e) {
    logger.warn("Gemini hashtag fill failed: {error}", { error: e });
    return [];
  }
}

export interface ResolveHashtagsOptions {
  geminiApiKey?: string;
  geminiModel?: string;
}

/**
 * Up to HASHTAG_COUNT hashtag labels (cheapest sources first). May return fewer; no generic padding.
 */
export async function resolveHashtags(
  entry: FeedEntry,
  botUsername: string,
  bot: BotConfig,
  opts: ResolveHashtagsOptions = {},
): Promise<string[]> {
  const pool: string[] = [];

  for (const c of entry.feedCategories) {
    const n = normalizeHashtagLabel(c);
    if (n) {
      dedupePush(pool, n);
    }
    if (pool.length >= HASHTAG_COUNT) {
      return pool.slice(0, HASHTAG_COUNT);
    }
  }

  for (const d of bot.default_hashtags ?? []) {
    const n = normalizeHashtagLabel(d);
    if (n) {
      dedupePush(pool, n);
    }
    if (pool.length >= HASHTAG_COUNT) {
      return pool.slice(0, HASHTAG_COUNT);
    }
  }

  for (const t of titleDerivedTags(entry.title)) {
    dedupePush(pool, t);
    if (pool.length >= HASHTAG_COUNT) {
      return pool.slice(0, HASHTAG_COUNT);
    }
  }

  if (pool.length < HASHTAG_COUNT && entry.link) {
    const h = hostnameDerivedTag(entry.link);
    if (h) {
      dedupePush(pool, h);
    }
  }

  const need = HASHTAG_COUNT - pool.length;
  const apiKey = opts.geminiApiKey ?? process.env.GEMINI_API_KEY;
  const model = opts.geminiModel ?? process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL;

  if (need > 0 && apiKey) {
    const geminiContext: GeminiHashtagContext = { botUsername, bot, entry };
    const filled = await tryGeminiFill({
      apiKey,
      model,
      need,
      context: geminiContext,
    });
    for (const t of filled) {
      dedupePush(pool, t);
      if (pool.length >= HASHTAG_COUNT) {
        break;
      }
    }
  }

  return pool.slice(0, HASHTAG_COUNT);
}
