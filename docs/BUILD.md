# Cloudflare Pages build

## Required settings (Dashboard → Settings → Builds)

| Setting | Value |
|---------|--------|
| **Production branch** | `main` |
| **Build command** | `pnpm run build` |
| **Build output directory** | `dist/public` |
| **Root directory** | `/` (repo root) |

Do **not** set the build command to bare `vite build …` — `vite` is not on PATH;
`pnpm run build` runs the package script which uses local `node_modules/.bin`.

## What `pnpm run build` does

```bash
vite build && node scripts/build-api.mjs
```

- Frontend → `dist/public`
- Worker → `dist/public/_worker.js`

## Retrying failed deploys

Do **not** “Retry deployment” on an old SHA (e.g. `7a9a5e8`). That rebuilds the broken commit.
Trigger a **new deployment from latest `main`** instead.
