import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import stylistic from "@stylistic/eslint-plugin";
import fedifyLint from "@fedify/lint";

export default defineConfig([
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    ...fedifyLint,
    files: ["src/lib/federation.ts"],
    rules: {
      ...fedifyLint.rules,
      // The actor is assembled in buildActor(), which these rules cannot follow;
      // src/lib/__tests__/protocol.test.ts asserts the served actor instead.
      "@fedify/lint/actor-id-required": "off",
      "@fedify/lint/actor-following-property-required": "off",
      "@fedify/lint/actor-followers-property-required": "off",
      "@fedify/lint/actor-outbox-property-required": "off",
      "@fedify/lint/actor-inbox-property-required": "off",
      "@fedify/lint/actor-shared-inbox-property-required": "off",
      "@fedify/lint/actor-preferred-username-required": "off",
      "@fedify/lint/collection-filtering-not-implemented": "off",
    },
  },
  {
    plugins: {
      "@next/next": nextPlugin,
      "@stylistic": stylistic,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  {
    ignores: ["node_modules/", ".next/"],
  },
  {
    rules: {
      curly: "error",
      "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: false }],
    },
  },
]);
