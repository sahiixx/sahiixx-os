# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Scope.** This is the modular SAHIIXX OS v4.0 — a full-stack React + Hono + tRPC app. It is a **WIP rewrite**, distinct from the single-file `C:\Users\sahii\sahiix-os-unified.js` and from the live WSL v3 backend (`sahiix-os-server.js`). See the home-root `C:\Users\sahii\CLAUDE.md` for the broader workstation picture. The **live NEXUS real-estate app is still the WSL `sahiix-estate` project**, not this one — this repo's Nexus is a separate deal-engine demo. All 7 module pages are built and run in **DEMO MODE** (seeded in-memory stores) until a valid Neon `DATABASE_URL` lands in `.dev.vars` (see Gotchas #1).

## Architecture

Monorepo-style: one Vite project serves the React frontend and the Hono/tRPC backend together in dev, and bundles them for Cloudflare Pages + Workers in prod.

```
Browser (React 19, react-router-dom)
  → tRPC client (src/providers/trpc.tsx, httpBatchLink → /api/trpc, superjson)
  → Hono app (api/boot.ts)
    → CORS * on everything; routes: /api/health, /api/env-check, /api/db-test, /api/trpc/*
    → appRouter = { sahiixx: sahiixx-router, ping }   (type AppRouter exported from boot.ts)
    → /api/trpc/* → fetchRequestHandler → tRPC procedures (api/sahiixx-router.ts)
      → getDb() (api/queries/connection.ts) → @neondatabase/serverless → Postgres
    → non-API GET * → Cloudflare ASSETS binding (static frontend) or 404
```

### Backend (`api/`)
- **`boot.ts`** — Hono entry + appRouter composition + Cloudflare env injection. A `*` middleware copies `c.env.DATABASE_URL` into `globalThis.__DATABASE_URL` (via `setDatabaseUrl`) on every request so the singleton DB client can read it. **This `globalThis` indirection is the key Cloudflare/Node compatibility seam** — Workers don't populate `process.env`.
- **`context.ts`** — tRPC factory (`router`, `publicProcedure`, `protectedProcedure`) with superjson transformer. **Auth is wired**: `protectedProcedure` verifies the JWT (jose, HS256) from the request context and throws `UNAUTHORIZED` if missing/invalid. `verifyBearer()` parses the `Authorization: Bearer …` header; `boot.ts` calls it in `createContext`. Mutating procedures (agentCreate/Update/Delete, dealCreate, signalCreate, deployedCreate) are `protectedProcedure`; all reads stay `publicProcedure`. **Multi-user auth**: `auth.login` checks the `users` table first (PBKDF2-SHA256 hash via Web Crypto in `api/lib/password.ts`), then falls back to the env-configured admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) so the first admin can log in before any DB rows exist. `auth.register` (protected — admin-gated) creates a new user with a hashed password. `auth.refresh` (protected) re-issues a token. Frontend stores the token in localStorage (`src/lib/auth.ts`), attaches it via the tRPC `headers()` in `src/providers/trpc.tsx`, and `src/components/RequireAuth.tsx` gates the Layout routes. The `users` table has a nullable `password_hash` column (migration `db/migrations/0000_*.sql`); env-admin is never a DB row.
- **`sahiixx-router.ts`** — procedures across the SAHIIXX domains: agents (CRUD), mcp (list), deals (list/create), contacts (list + search by `like` on name + create), campaigns (list + create), videos (list + create), signals (list/create), deployedAgents (list/create), plus `dbStatus` and the Command Center ops procedures (`opsMetrics`, `opsPipeline`, `opsModels`, `moduleCounts`), plus the Postiz procedures (`postizStatus`, `postizIntegrations`, `postizSchedule`). Imports schema via the `@db/schema` alias and uses drizzle query builder (`eq`, `desc`, `like`).
- **`queries/demo-data.ts`** — **seeded in-memory fallback stores** (agents/mcp/deals/contacts/campaigns/videos/signals/deployed) typed via drizzle `$inferSelect` so demo rows match real DB row types exactly. Every read in `sahiixx-router.ts` tries the real DB first and falls back to these stores on ANY error (Neon unreachable, invalid creds, missing `DATABASE_URL`); writes append to the demo store on DB failure. So the whole UI is interactive with zero DB. The moment a valid Neon URL is restored, queries auto-switch back because the try succeeds first. `dbStatus` exposes `{demo, error}` so the Layout banner can show "DEMO MODE".
- **`postiz.ts`** — minimal Postiz Public API client (`listIntegrations`, `createPost`, `deletePost`, `probePostiz`) used by SARA for real social scheduling. Auth: `Authorization: <key>` header (no Bearer prefix). Returns `null`/`{available:false}` when `POSTIZ_API_URL`/`POSTIZ_API_KEY` aren't set.
- **`auth-router.ts`** — `auth.login` (issues 12h HS256 JWT for the single admin) + `auth.me` (echoes the verified user from ctx). Part of `appRouter` as `auth`.
- **`queries/connection.ts`** — singleton `getDb()` returning `drizzle(neon(url), {schema})`. Throws if `DATABASE_URL` is missing. `testConnection()` runs `SELECT 1`.
- **`lib/env.ts`** — env getter reading `globalThis.__DATABASE_URL ?? process.env.DATABASE_URL`. Exists because Cloudflare Workers don't populate `process.env`. Also holds the Jarvis + ElevenLabs + Postiz getters (all optional; `boot.ts` injects them from `c.env` per request).

### Database (`db/`)
- **`schema.ts`** — 9 `pgTable`s (users, agents, mcp_servers, deals, contacts, campaigns, videos, signal_alerts, deployed_agents) + 9 `pgEnum`s. `contacts` has `rfm_score` + a `contact_tier` enum (Champions/Top/Loyal/At Risk).
- **`drizzle.config.ts`** — schema `./db/schema.ts`, migrations out `./db/migrations`, dialect postgresql, url from `DATABASE_URL`. A migration `db/migrations/0000_*.sql` (+ meta) is **generated but NOT applied** to Neon yet — `npm run db:push` applies schema directly, `npm run db:migrate` applies the generated file. Either works once `DATABASE_URL` is valid.
- No `db/seed.ts` exists yet, despite the `db:seed` script referencing it.

### Frontend (`src/`)
- **`main.tsx` → `App.tsx`** — routes. `/` and `/login` are standalone; everything else (`/hub`, `/command-center`, `/nexus`, `/goldmine`, `/sara`, `/signals`, `/gapclaw`) is wrapped in `Layout`.
- **`providers/trpc.tsx`** — `createTRPCReact<AppRouter>()` typed against the **backend** `AppRouter` type imported from `../../api/boot`. `getBaseUrl()` returns `""` in browser (same-origin) or `http://localhost:3000` on server. **Dev and prod both assume same-origin `/api/trpc`** — works on Cloudflare Pages (Worker + assets same origin) and in Vite dev (the `@hono/vite-dev-server` plugin serves `api/boot.ts` on port 3000).
- **`hooks/useSahiixxData.ts`** — thin React Query wrappers over every tRPC procedure, incl. the new `useDbStatus`, `useContactCreate`, `useCampaignCreate`, `useVideoCreate`, the Command Center ops hooks (`useOpsMetrics/Pipeline/Models`, `useModuleCounts`), and the Postiz hooks (`usePostizStatus/Integrations/Schedule`). Live polling lives only here: `agentList` 5s, `mcpList` 10s, `signalList` 3s, `opsMetrics` 5s. `placeholderData: []` keeps tables from flashing empty.
- **All 7 module pages are built** (as of 2026-07-12). `Hub` (launcher with live per-module counts), `CommandCenter` (terminal-style ops dashboard — 6-agent fleet w/ progress, CI/CD pipeline stages, live system metrics, model registry, working slash-command terminal), `Nexus` (deal engine — tiles, pipeline BarChart, create-deal, deal table), `Goldmine` (CRM — RFM tier tiles, searchable contact table, create-contact), `Sara` (content factory — video pipeline + campaigns dashboards, create-video/campaign, and a Postiz social-scheduler panel when configured), `Signals` (live alert feed — severity tiles, recharts distribution, create-signal, animated feed), `GapClaw` (agent builder — agents CRUD, MCP list, deployed agents + launch). All consume tRPC procedures with graceful `{error && …}` handling. Design language: black/void/surface surfaces, red-primary accent + per-module accents (nexus/goldmine/sara/gapclaw), Orbitron display / JetBrains Mono / Inter, recharts + framer-motion. `Signals` is the gold-standard reference page. **`Hub` uses explicit accent lookup maps (NOT interpolated `text-${color}`)** — Tailwind JIT can't generate interpolated class names, a gotcha that bit the original Hub.
- **`Layout.tsx`** — nav + a **DEMO MODE banner** that queries `dbStatus` and shows when `demo=true` (Neon unreachable).

### Path aliases (vite + tsconfig)
`@/*` → `src/*`, `@db/*` → `db/*`, `@contracts/*` → `contracts/*`. **No `contracts/` dir exists yet** — alias is reserved for future shared zod/tRPC contracts.

## Commands

```bash
npm run dev          # Vite dev server (port 3000) + @hono/vite-dev-server serving api/boot.ts
npm run check        # tsc -b (typecheck only — noEmit)
npm run build        # vite build → dist/public (frontend) + esbuild bundle api/boot.ts → dist/boot.js (Worker)
npm start            # NODE_ENV=production node dist/boot.js (non-Cloudflare run)
npm run db:push      # drizzle-kit push  — apply schema to Neon (no migration files)
npm run db:generate  # drizzle-kit generate — emit migration files
npm run db:migrate   # drizzle-kit migrate — apply migrations
npm run db:seed      # tsx db/seed.ts — NOTE: db/seed.ts does not exist yet
```

There is no test runner, lint, or format command configured. `check` (`tsc -b`) is the only static gate.

## Secrets / env

- **Env vars:** `DATABASE_URL` (Neon Postgres, `?sslmode=require`), `AUTH_SECRET` (JWT signing key), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (single admin account). Optional Jarvis/voice/scheduler keys: `OPENROUTER_API_KEY` / `JARVIS_MODEL` / `JARVIS_PROVIDER` / `OLLAMA_URL` / `JARVIS_OLLAMA_MODEL` (Jarvis LLM), `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` / `ELEVENLABS_MODEL` (Jarvis TTS — preferred over OpenAI), `OPENAI_API_KEY` (fallback TTS), `POSTIZ_API_URL` / `POSTIZ_API_KEY` (SARA real social scheduling). All optional; zero keys = local Ollama LLM + browser speechSynthesis + local-tracking SARA. See `.env.example` for the full template.
- **Local Wrangler dev:** `.dev.vars` (gitignored). Note: Vite dev (`npm run dev`) reads `.env` files, **not** `.dev.vars` — so for `npm run dev` either create a `.env` (gitignored) or rely on the dev fallbacks (`AUTH_SECRET` → dev secret with warning; admin creds → `admin@sahiixx.os` / `sahiixx`).
- **Cloudflare Pages/Workers:** set all as Pages secrets or via `wrangler secret put`. `boot.ts` copies them from `c.env` into `globalThis` per request.
- **Plain Node (e.g. a script importing `api/`):** set `process.env.*` or call the `set*` helpers — the `globalThis` values are only populated by the `boot.ts` middleware.
- Template: `.env.example`.

## Gotchas

1. **Auth is enforced on writes** — mutating procedures are `protectedProcedure` (JWT-gated); reads remain public. Login is DB-backed (PBKDF2 password hash on `users.password_hash`) with an env-admin bootstrap fallback (`ADMIN_EMAIL`/`ADMIN_PASSWORD`, dev fallback `admin@sahiixx.os` / `sahiixx`). `auth.register` is admin-gated (bootstrap admin creates the first real users). Set `AUTH_SECRET` in production (`.dev.vars` for local Wrangler; Cloudflare Pages secret via `npx wrangler secret put AUTH_SECRET` for prod) — without it a dev fallback is used and warned about.

> **Pending (needs you):** (a) the Neon `DATABASE_URL` in `.dev.vars` is **invalid** (`password authentication failed for user sahiixx_owner`) — the app currently runs in **DEMO MODE** (seeded in-memory stores in `api/queries/demo-data.ts`) until you put a valid Neon connection string there. The whole UI still works in demo mode; writes append to the in-memory store (lost on restart). (b) The migration `db/migrations/0000_*.sql` (full schema incl. `password_hash`) is **generated but not applied** — run `npm run db:push` (or `db:migrate`) once creds are valid. After that, queries auto-switch to live Neon and the DEMO MODE banner disappears (no code changes needed). DB-backed login/register can't be verified until both are resolved; env-admin login + token refresh work now.
2. **`contactSearch`** uses `%${input.query}%` inside drizzle's `like()` — drizzle parameterizes it (safe from injection), but it's a substring match, not full-text search.
3. **DB client is a module singleton** keyed off `globalThis.__DATABASE_URL`, set per-request by `boot.ts`. Outside the Cloudflare/Vite request path you must set `DATABASE_URL` yourself or the singleton throws.
4. **All 7 module pages are built** (`Hub`, `CommandCenter`, `Nexus`, `Goldmine`, `Sara`, `Signals`, `GapClaw`) — they are NOT stubs anymore (as of 2026-07-12). The live NEXUS real-estate app is still the WSL `sahiix-estate` project (this repo's Nexus is a separate deal-engine demo). The `*.json` NEXUS files at the home root are exports of the WSL app, not this repo.
5. **Tailwind JIT can't generate interpolated class names** (`text-${color}`, `border-${tone}/40`). Use explicit complete strings or lookup maps — see Hub's `ACCENT` map and Jarvis's `TONE_*` maps. Bitten repeatedly.
6. **Bundle is code-split** (`vite.config.ts` `manualChunks`): react/trpc/chart/motion/icon vendor chunks + the app `index` chunk. Largest is `chart-vendor` (recharts, ~400KB) loaded in parallel. `chunkSizeWarningLimit: 600`.
7. **Deploy:** frontend → Cloudflare Pages (connect the GitHub repo, `dist/public` is the build output per `wrangler.toml`); backend → Cloudflare Workers from the `api/` folder; DB schema → `drizzle-kit push` against Neon.
8. **Jarvis local-model tool-calling is unreliable — there's a recovery layer.** The small local Ollama model (`JARVIS_OLLAMA_MODEL`, ceiling `llama3.2:3b`) often emits a tool call as **raw JSON text** (`{"name":"system_status","parameters":{}}`) instead of a structured `tool_calls` chunk — so the call never runs and the JSON leaks to the user as the "answer." `api/jarvis/llm.ts` `parseTextToolCall()` (called first inside the one-shot `intentFallback`) rescues this: if the *entire* assistant content is a JSON object `{name, parameters|arguments|args}` naming a real tool, it synthesizes the call. Safe because the downstream gates (`allowOsControl`, `validatePath`, per-op `CONFIRM`) still apply. An `OPENROUTER_API_KEY` + `JARVIS_PROVIDER=openrouter` bypasses this entirely with a real model's structured tool-calling. **Verified live on the wire** with four throwaway drivers in the repo root (regression checks, not committed code): `_drive3.ts` (22 OS-control safety assertions via `npx tsx _drive3.ts`), `_drive4.mjs` (realtime SSE stream assertions via `node _drive4.mjs` — login, tool-call recovery, audio-before-`turn_end`, clean stream close), `_drive5.mjs` (the approvals CONFIRM round-trip via `node _drive5.mjs` — `/api/jarvis/approve` route auth/nonce/shape checks deterministically, plus a best-effort LLM-path `file_delete` → `approvals` SSE event → `/approve` → file-actually-deleted loop that's model-dependent and goes deterministic with an `OPENROUTER_API_KEY`), and `_drive6.mjs` (barge-in's server-side half via `node _drive6.mjs` — abort a mid-flight SSE fetch → clean `AbortError`, then a follow-up turn on the same sessionId completes normally, proving an interrupted turn doesn't corrupt the in-memory session; the audio-cancel half is browser-only). Re-run all four after touching `api/jarvis/*`.