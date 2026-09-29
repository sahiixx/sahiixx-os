# Cloudflare Pages build

**Command:** `pnpm install` then `npm run build`

**Script:**

```bash
vite build && node scripts/build-api.mjs
```

- Frontend → `dist/public`
- Worker → `dist/public/_worker.js`
- Output dir (wrangler): `pages_build_output_dir = "dist/public"`

Do **not** use `turbo run build` as the sole pipeline — this is a single-package Vite app.
