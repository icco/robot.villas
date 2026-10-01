# AGENTS.md

Guidance for coding agents working on robot.villas.

## Project Overview

ActivityPub / fediverse server built with Fedify 2.4, Next.js 16 (App Router), Drizzle ORM + PostgreSQL, Tailwind CSS 4 + DaisyUI 5, and optional Google GenAI (Gemini) hashtags.
- App routes: `src/app/`; federation request routing: `src/proxy.ts`
- Federation: `src/lib/federation.ts` (inbox state in `inbox-state.ts`), started from `src/instrumentation.ts`
- Schema & migrations: `src/lib/schema.ts`, `src/lib/db.ts`; SQL in `drizzle/` (generate with `pnpm db:generate`, never hand-edit)
- Delivery, retries, and limits: `docs/operations.md`

## Commands

Use pnpm (Node >= 26):
- `pnpm dev` / `pnpm build` / `pnpm start`
- `pnpm test` — Vitest; DB-backed tests need `DATABASE_URL` pointing at a disposable PostgreSQL database
- `pnpm lint:check` — what CI runs (ESLint incl. `@fedify/lint`, YAML format, typecheck); `pnpm lint` fixes
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm validate-feeds --skip-network` — validate `feeds.yml`

## Conventions

- TypeScript everywhere, strict type checking.
- Conventional Commits with lowercase subjects (e.g. `feat(actor): handle follow activity`).
- Keep Next.js 16 App Router patterns and server/client boundaries clear.
- Use `^` ranges for dependencies.
- Build actors inline in the actor dispatcher so `@fedify/lint` can check them; don't disable its rules.
- Inbox handlers must check that the sender owns what it changes, and must be safe to run twice.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
