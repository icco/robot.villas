import { readFileSync } from "node:fs";
import { load as parseYaml } from "js-yaml";
import { z } from "zod";

const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_SUMMARY_LENGTH = 500;

const BotSchema = z.object({
  feed_url: z.string().url(),
  display_name: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
  summary: z.string().min(1).max(MAX_SUMMARY_LENGTH),
});

export const FeedsConfigSchema = z.object({
  bots: z.record(
    z.string().regex(/^[a-z0-9_]+$/, "Bot username must be lowercase alphanumeric or underscore"),
    BotSchema,
  ).refine((bots) => Object.keys(bots).length > 0, "At least one bot must be defined"),
});

export type BotConfig = z.infer<typeof BotSchema>;
export type FeedsConfig = z.infer<typeof FeedsConfigSchema>;

export function loadConfig(path: string): FeedsConfig {
  const raw = readFileSync(path, "utf-8");
  return parseConfig(raw);
}

export function parseConfig(yaml: string): FeedsConfig {
  const data = parseYaml(yaml);
  return FeedsConfigSchema.parse(data);
}
