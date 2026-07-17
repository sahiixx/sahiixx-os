# SAHIIXX OS

Full-stack cyberpunk operating system — modules, real Neon Postgres, Cloudflare Pages edge API.

**Version:** 4.3.0 · **Prod:** https://sahiixx-os.pages.dev

### Cloudflare connectors (this deploy)
| Binding / secret | Purpose |
|------------------|---------|
| Hyperdrive `HYPERDRIVE` | Neon TCP pooler (optional path) |
| Workers AI `AI` | Edge LLM probe / future Jarvis fallback |
| Observability | Live logs in CF dashboard |
| Secrets | `DATABASE_URL`, `AUTH_*`, `OLLAMA_*`, `OPENROUTER_*`, `ELEVENLABS_*`, … |

## Stack
- **Frontend:** React 19 + TypeScript + Tailwind + Vite 7
- **Backend:** Hono + tRPC 11 + Drizzle ORM (on Pages `_worker.js`)
- **Database:** Neon Postgres (HTTP) + optional Cloudflare Hyperdrive
- **Auth:** JWT (HS256 / jose) — env-admin bootstrap + DB users
- **Deploy:** Cloudflare Pages + Hyperdrive binding

## Routes
| Path | Module |
|------|--------|
| `/` | Boot sequence |
| `/login` | Auth |
| `/hub` | Module launcher |
| `/command-center` | Ops dashboard |
| `/nexus` | Deal engine |
| `/goldmine` | CRM |
| `/sara` | Content factory |
| `/signals` | Alert feed |
| `/gapclaw` | Agent builder |
| `/documents` | OCR + FTS archive |
| `/jarvis` | Voice agent |
| `/status` | **System status / audit / metrics** |

## Ops endpoints
| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Liveness |
| `GET /api/ready` | Readiness (DB required → 503 if down) |
| `GET /api/version` | App version |
| `GET /api/metrics` | Prometheus text counters |
| `GET /api/env-check` | Binding diagnostics (no secret values) |
| `GET /api/db-test` | Neon + Hyperdrive probe |
| `/api/trpc/*` | App API (superjson) |

## tRPC routers
`sahiixx` · `auth` · `jarvis` · `documents` · `system` · `nexus` · `ping`

### Live NEXUS estate bridge
- Local: defaults to `http://127.0.0.1:3001` (WSL `estate-api`)
- Prod: **named Cloudflare Tunnel** `sahiix-estate` (stable UUID; survives restarts)
  - Tunnel ID: `4d78e2cb-36d3-4785-9e7d-a84d1181f651`
  - CNAME target: `4d78e2cb-36d3-4785-9e7d-a84d1181f651.cfargotunnel.com`
  - Connector (WSL user systemd): `npm run tunnel:estate`
  - Public hostname (requires a zone on this CF account):
    ```powershell
    # once you have a domain on Cloudflare (0 zones today):
    npm run tunnel:estate:dns -- -Hostname estate.YOURDOMAIN.com
    # puts DNS CNAME + tunnel ingress + Pages secret ESTATE_API_URL
    ```
  - Interim without a zone (auto-heal every 10 min):
    ```bash
    npm run tunnel:estate:quick   # start trycloudflare public bridge
    npm run tunnel:estate:sync    # put ESTATE_API_URL + probe prod (needs redeploy if secret was stale)
    npm run tunnel:estate:heal    # restart bridge if dead
    ```
    WSL timer `estate-public-heal.timer` runs heal every 10 min. **Pages secrets are snapshotted per deploy** — after syncing a new URL, run `npx wrangler pages deploy dist/public --project-name=sahiixx-os` if prod still shows the old tunnel host.
  ```bash
  npm run tunnel:estate
  # after DNS is wired:
  npm run smoke:prod
  ```
- UI: Nexus page → **LIVE ESTATE LEADS** + Import → Deal
- tRPC: `nexus.estateHealth` · `nexus.estateLeads` · `nexus.importLeadAsDeal`

### Auth highlights
- Login rate limit (10 / 15 min per email)
- `auth.bootstrapAdmin` — promote env admin into `users` table
- `auth.changePassword` · `auth.listUsers` (admin)
- Activity audit on login / register / password change

### System highlights
- Integration matrix (DB, LLMs, OPA, Postiz, ElevenLabs)
- Activity event log (`activity_events` + memory fallback)
- Heartbeat mutation for ops checks

## Database
Tables: users, agents, mcp_servers, deals, contacts, campaigns, videos, signal_alerts, deployed_agents, documents, document_types, matching_rules, **activity_events**

```bash
npm run db:push      # push schema to Neon
npm run db:seed      # seed demo rows
```

## Local dev
```bash
# secrets in .dev.vars (never commit)
npm install
npm run dev          # Vite :3000 + API middleware
```

## Deploy
```bash
npm run build
npx wrangler pages deploy dist/public --project-name=sahiixx-os
# Secrets: DATABASE_URL AUTH_SECRET ADMIN_EMAIL ADMIN_PASSWORD (+ optional LLM keys)
```

## Default login (change after bootstrap)
- Email: `admin@sahiixx.os`
- Password: from `ADMIN_PASSWORD` / `.dev.vars`
