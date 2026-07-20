#!/usr/bin/env tsx
/**
 * Validates feeds.yml:
 *   1. Schema correctness (via Zod, same rules the app uses at startup)
 *   2. Each profile_photo URL is reachable and returns a Mastodon-compatible
 *      image MIME type (png / jpeg / webp / gif).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";
import { FeedsConfigSchema } from "../src/lib/config";

const VALID_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const TIMEOUT_MS = 15_000;
const USER_AGENT = "robot.villas-feed-validator/1.0 (feed validation bot)";
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function probeUrl(url: string): Promise<
  | { kind: "ok"; contentType: string }
  | { kind: "wrong_mime"; contentType: string }
  | { kind: "blocked"; status: number }
  | { kind: "http_error"; status: number }
  | { kind: "network_error"; detail: string }
> {
  const headers = { "User-Agent": USER_AGENT };
  try {
    let res = await fetch(url, {
      method: "HEAD",
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Some servers reject HEAD — retry with a byte-range GET
    if (res.status === 405) {
      res = await fetch(url, {
        method: "GET",
        headers: { ...headers, Range: "bytes=0-0" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    }
    // WAFs (e.g. Cloudflare) intermittently reject bot user agents — retry as a browser
    if (res.status === 403 || res.status === 429) {
      res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": BROWSER_USER_AGENT, Range: "bytes=0-0" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 403 || res.status === 429) {
        return { kind: "blocked", status: res.status };
      }
    }
    if (!res.ok && res.status !== 206) {
      return { kind: "http_error", status: res.status };
    }
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (contentType && !VALID_MIME_TYPES.has(contentType)) {
      return { kind: "wrong_mime", contentType };
    }
    return { kind: "ok", contentType };
  } catch (err) {
    return { kind: "network_error", detail: String(err) };
  }
}

async function main() {
  const configPath = join(process.cwd(), "feeds.yml");
  const raw = readFileSync(configPath, "utf-8");

  // Step 1: schema validation
  const parsed = parseYaml(raw);
  const result = FeedsConfigSchema.safeParse(parsed);
  if (!result.success) {
    console.error("✗ feeds.yml schema validation failed:");
    for (const issue of result.error.issues) {
      console.error(`    [${issue.path.join(".")}] ${issue.message}`);
    }
    process.exit(1);
  }
  const config = result.data;
  console.log(`✓ Schema valid — ${Object.keys(config.bots).length} bots`);

  // Step 2: profile photo checks
  const bots = Object.entries(config.bots).filter(([, b]) => b.profile_photo);
  console.log(`\nChecking ${bots.length} profile photos…\n`);

  const errors: string[] = [];
  const warnings: string[] = [];

  await Promise.all(
    bots.map(async ([name, bot]) => {
      const url = bot.profile_photo!;
      const r = await probeUrl(url);

      if (r.kind === "blocked") {
        warnings.push(
          `[${name}] HTTP ${r.status} — server blocks automated probes, cannot verify\n    ${url}`,
        );
      } else if (r.kind === "wrong_mime") {
        errors.push(
          `[${name}] MIME type "${r.contentType}" is not supported by Mastodon — use png/jpeg/gif/webp\n    ${url}`,
        );
      } else if (r.kind === "http_error") {
        errors.push(`[${name}] HTTP ${r.status}\n    ${url}`);
      } else if (r.kind === "network_error") {
        errors.push(`[${name}] unreachable — ${r.detail}\n    ${url}`);
      }
    }),
  );

  if (warnings.length > 0) {
    console.log(`${warnings.length} warning(s):\n`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }

  if (errors.length > 0) {
    console.error(`${errors.length} error(s):\n`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  console.log("✓ All profile photos are reachable and have valid MIME types");
}

main();
