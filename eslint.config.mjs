import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import stylistic from "@stylistic/eslint-plugin";

export default defineConfig([
  js.configs.recommended,
  tseslint.configs.recommended,
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
