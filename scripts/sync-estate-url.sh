#!/usr/bin/env bash
# Parse trycloudflare URL from cloudflared log and print it.
# Optional: SYNC_PAGES=1 CLOUDFLARE_API_TOKEN=... wrangler in PATH → put ESTATE_API_URL
set -euo pipefail
LOGS=(
  "$HOME/estate-tunnel.log"
  "/mnt/c/Users/sahii/sahiixx-os/scripts/estate-tunnel.log"
)
URL=""
for f in "${LOGS[@]}"; do
  if [ -f "$f" ]; then
    URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$f" | tail -1 || true)
    [ -n "$URL" ] && break
  fi
done
if [ -z "$URL" ]; then
  echo "no tunnel URL found in logs" >&2
  exit 1
fi
echo "$URL"
# write local cache for tools
echo "$URL" > /mnt/c/Users/sahii/sahiixx-os/scripts/estate-tunnel.url 2>/dev/null || true
echo "$URL" > "$HOME/estate-tunnel.url" 2>/dev/null || true

if [ "${SYNC_PAGES:-0}" = "1" ]; then
  if ! command -v npx >/dev/null 2>&1 && ! command -v wrangler >/dev/null 2>&1; then
    echo "wrangler/npx not available for secret put" >&2
    exit 2
  fi
  printf '%s' "$URL" | npx --yes wrangler pages secret put ESTATE_API_URL --project-name=sahiixx-os
  echo "Pages secret ESTATE_API_URL updated"
fi
