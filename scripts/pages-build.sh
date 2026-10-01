#!/usr/bin/env bash
# Cloudflare Pages entrypoint — never rely on bare `vite` on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -d node_modules ]]; then
  echo "Installing deps with pnpm..."
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install
  else
    npm install
  fi
fi

VITE_BIN="./node_modules/vite/bin/vite.js"
if [[ ! -f "$VITE_BIN" ]]; then
  VITE_BIN="./node_modules/.bin/vite"
fi
if [[ ! -e "$VITE_BIN" ]]; then
  echo "ERROR: vite not installed. package.json must list vite; run pnpm install."
  ls -la node_modules 2>/dev/null | head -20 || true
  exit 1
fi

echo ">> vite build (via $VITE_BIN)"
node "$VITE_BIN" build

echo ">> build-api.mjs"
node scripts/build-api.mjs

echo ">> build done: dist/public"
ls -la dist/public | head -20
