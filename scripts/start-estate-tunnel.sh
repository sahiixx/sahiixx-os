#!/usr/bin/env bash
set -euo pipefail
CF="${HOME}/.local/bin/cloudflared"
LOG="/mnt/c/Users/sahii/sahiixx-os/scripts/estate-tunnel.log"
PIDF="/mnt/c/Users/sahii/sahiixx-os/scripts/estate-tunnel.pid"

# kill previous
if [ -f "$PIDF" ]; then
  old=$(cat "$PIDF" || true)
  if [ -n "${old:-}" ] && kill -0 "$old" 2>/dev/null; then
    kill "$old" 2>/dev/null || true
    sleep 1
  fi
fi

# ensure estate up
systemctl --user start estate-api 2>/dev/null || true
curl -fsS -m 3 http://127.0.0.1:3001/health >/dev/null

: > "$LOG"
nohup "$CF" tunnel --url http://127.0.0.1:3001 --no-autoupdate >>"$LOG" 2>&1 &
echo $! > "$PIDF"
echo "started pid=$(cat "$PIDF")"

# wait for trycloudflare URL
for i in $(seq 1 30); do
  if grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$LOG" | head -1; then
    exit 0
  fi
  sleep 1
done
echo "TIMEOUT waiting for tunnel URL" >&2
tail -30 "$LOG" >&2
exit 1
