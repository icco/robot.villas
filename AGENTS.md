# AGENTS.md

Guidance for coding agents working on robot.villas.

## Project Overview

ActivityPub / Fediverse server built with Fedify, Next.js 16 (App Router), Drizzle ORM + PostgreSQL, Tailwind CSS 4 + DaisyUI 5, and Google GenAI (Gemini).
- App routes: `src/app/`
- Fediverse integration: `src/lib/federation.ts` (initialized from `src/instrumentation.ts`)
- Database schema & migrations: Drizzle schema/DB helpers in `src/lib/schema.ts` and `src/lib/db.ts`; SQL migrations in `drizzle/`
- Scripts & validation: `scripts/validate-feeds.ts`

## Commands

Use pnpm (Node >= 26):
- `pnpm dev` — Start Next.js development server
- `pnpm build` — Build production application
- `pnpm start` — Run production server
- `pnpm test` — Run Vitest suite once (`pnpm test:watch` for watch mode)
- `pnpm lint` — Run ESLint with auto-fix, format YAML, and run typecheck
- `pnpm typecheck` — Run TypeScript compiler check (`tsc --noEmit`)
- `pnpm db:generate` / `pnpm db:push` — Generate or push Drizzle schema changes

## Conventions

- TypeScript everywhere, strict type checking.
- Conventional Commits with lowercase subjects (e.g. `feat(actor): handle follow activity`).
- Keep Next.js 16 App Router patterns and server/client boundaries clear.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
