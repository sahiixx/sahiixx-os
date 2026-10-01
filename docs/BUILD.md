# Cloudflare Pages — required settings

## Dashboard → Settings → Builds and deployments

| Setting | Exact value |
|---------|-------------|
| **Production branch** | `main` |
| **Build command** | `pnpm run build` |
| **Build output directory** | `dist/public` |
| **Root directory** | *(empty / `/`)* |
| **Node version** | `22` (env `NODE_VERSION=22`) |

Alternative build command (same result):

```text
bash scripts/pages-build.sh
```

## Do not

- Retry a failed deployment of commit `7a9a5e8` — that SHA predates the fix.
- Use bare `vite build` as the build command (`vite` is not on PATH).

## After changing settings

**Deployments → Create deployment** from branch **`main`** (latest commit), or push any commit to `main`.

Confirm the log shows:

```text
HEAD is now at <NOT 7a9a5e8>
> pnpm run build
>> vite build
>> build-api.mjs
```
