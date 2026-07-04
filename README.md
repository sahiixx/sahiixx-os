# SAHIIXX OS

Full stack cyberpunk operating system with 8 modules, real-time data, and Neon Postgres backend.

## Stack
- Frontend: React 19 + TypeScript + Tailwind CSS + Vite
- Backend: Hono + tRPC 11 + Drizzle ORM
- Database: Neon Postgres
- Auth: OAuth 2.0
- Deploy: Cloudflare Pages + Workers

## Routes
- `/` Boot Sequence
- `/hub` Module Launcher
- `/command-center` 6-tab Dashboard
- `/nexus` NEXUS Deal Engine
- `/goldmine` Goldmine Protocol CRM
- `/sara` SARA Content Factory
- `/signals` Live Signal Feed
- `/gapclaw` GapClaw Agent Builder

## Database
9 tables: users, agents, mcp_servers, deals, contacts, campaigns, videos, signal_alerts, deployed_agents

## Deploy
Frontend: Connect GitHub repo to Cloudflare Pages
Backend: Deploy `api/` folder to Cloudflare Workers
Database: Schema auto-pushed via `drizzle-kit push`
