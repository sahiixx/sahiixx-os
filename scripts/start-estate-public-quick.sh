#!/usr/bin/env bash
# Interim public trycloudflare bridge (URL changes on restart).
# Named tunnel connector stays separate (estate-tunnel.service).
set -euo pipefail
CF="${HOME}/.local/bin/cloudflared"
LOG="/mnt/c/Users/sahii/sahiixx-os/scripts/estate-public-quick.log"
PIDF="/mnt/c/Users/sahii/sahiixx-os/scripts/estate-public-quick.pid"
URLF="/mnt/c/Users/sahii/sahiixx-os/scripts/estate-tunnel.url"

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
      if curl -fsS -m 8 "$U/health" >/dev/null 2>&1; then
        echo "$U"
        echo "$U" > "$URLF"
        echo "$U" > "${HOME}/estate-tunnel.url" 2>/dev/null || true
        exit 0
      fi
      sleep 1
    done
    echo "$U" > "$URLF"
    echo "WARN tunnel URL up but /health not ready yet: $U" >&2
    echo "$U"
    exit 0
  fi
  sleep 1
done
echo "TIMEOUT waiting for trycloudflare URL" >&2
tail -30 "$LOG" >&2
exit 1
