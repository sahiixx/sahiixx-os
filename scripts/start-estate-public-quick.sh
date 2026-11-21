#!/usr/bin/env bash
# Interim public trycloudflare bridge (URL changes on restart).
# Named tunnel connector stays separate (estate-tunnel.service).
set -euo pipefail
CF="${HOME}/.local/bin/cloudflared"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=estate-health.sh
source "$ROOT/scripts/estate-health.sh"
LOG="$ROOT/scripts/estate-public-quick.log"
PIDF="$ROOT/scripts/estate-public-quick.pid"
URLF="$ROOT/scripts/estate-tunnel.url"

if [ -f "$PIDF" ]; then
  old=$(cat "$PIDF" || true)
  if [ -n "${old:-}" ] && kill -0 "$old" 2>/dev/null; then
    kill "$old" 2>/dev/null || true
    sleep 1
  fi
fi

curl -fsS -m 3 http://127.0.0.1:3001/health >/dev/null
: > "$LOG"
nohup "$CF" tunnel --url http://127.0.0.1:3001 --no-autoupdate >>"$LOG" 2>&1 &
echo $! > "$PIDF"

for i in $(seq 1 30); do
  U=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  if [ -n "$U" ]; then
    # Wait until origin is reachable through the edge
    for j in $(seq 1 20); do
      if estate_publish_url "$U" "$URLF"; then
        echo "$U"
        echo "$U" > "${HOME}/estate-tunnel.url" 2>/dev/null || true
        exit 0
      fi
      sleep 1
    done
    echo "FAIL public /health not ready; previous published URL preserved" >&2
    exit 1
  fi
  sleep 1
done
echo "TIMEOUT waiting for trycloudflare URL" >&2
tail -30 "$LOG" >&2
exit 1
