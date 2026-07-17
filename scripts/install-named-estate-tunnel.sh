#!/usr/bin/env bash
# Install/run named Cloudflare Tunnel "sahiix-estate" → http://127.0.0.1:3001
# Token file: ~/.cloudflared/sahiix-estate.token  (or scripts/.estate-tunnel-token on Windows mount)
set -euo pipefail

CF="${HOME}/.local/bin/cloudflared"
TOKEN_DST="${HOME}/.cloudflared/sahiix-estate.token"
TOKEN_SRC_WIN="/mnt/c/Users/sahii/sahiixx-os/scripts/.estate-tunnel-token"
UNIT_DST="${HOME}/.config/systemd/user/estate-tunnel.service"
LOG="${HOME}/estate-tunnel.log"
WIN_LOG="/mnt/c/Users/sahii/sahiixx-os/scripts/estate-tunnel.log"
URL_FILE="${HOME}/estate-tunnel.url"
WIN_URL="/mnt/c/Users/sahii/sahiixx-os/scripts/estate-tunnel.url"

# Tunnel UUID (sahiix-estate) — public hostname after DNS CNAME:
#   estate.<your-zone> → 4d78e2cb-36d3-4785-9e7d-a84d1181f651.cfargotunnel.com
TUNNEL_ID="4d78e2cb-36d3-4785-9e7d-a84d1181f651"
TUNNEL_NAME="sahiix-estate"

mkdir -p "${HOME}/.cloudflared" "${HOME}/.config/systemd/user"

if [[ ! -x "$CF" ]]; then
  echo "cloudflared missing at $CF — run scripts/install-cloudflared-wsl.sh" >&2
  exit 1
fi

if [[ -f "$TOKEN_SRC_WIN" ]]; then
  cp -f "$TOKEN_SRC_WIN" "$TOKEN_DST"
elif [[ ! -f "$TOKEN_DST" ]]; then
  echo "No tunnel token. Place it at $TOKEN_SRC_WIN or $TOKEN_DST" >&2
  exit 1
fi
chmod 600 "$TOKEN_DST"
# cloudflared reads TUNNEL_TOKEN from EnvironmentFile (not argv)
printf 'TUNNEL_TOKEN=%s\n' "$(cat "$TOKEN_DST")" > "${HOME}/.cloudflared/sahiix-estate.env"
chmod 600 "${HOME}/.cloudflared/sahiix-estate.env"

# Estate API must be up
systemctl --user start estate-api 2>/dev/null || true
if ! curl -fsS -m 5 http://127.0.0.1:3001/health >/dev/null; then
  echo "estate-api :3001 not healthy" >&2
  exit 1
fi

cat > "$UNIT_DST" <<'UNIT'
[Unit]
Description=Cloudflare named tunnel sahiix-estate → :3001
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=%h/.cloudflared/sahiix-estate.env
ExecStart=%h/.local/bin/cloudflared tunnel --no-autoupdate run
Restart=always
RestartSec=5
StandardOutput=append:%h/estate-tunnel.log
StandardError=append:%h/estate-tunnel.log

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable estate-tunnel.service
systemctl --user restart estate-tunnel.service
sleep 3

if ! systemctl --user is-active --quiet estate-tunnel.service; then
  echo "estate-tunnel failed to start" >&2
  journalctl --user -u estate-tunnel -n 40 --no-pager >&2 || true
  tail -40 "$LOG" 2>/dev/null >&2 || true
  exit 1
fi

# Stable target for DNS CNAME (user must point a hostname here once they have a zone)
STABLE="https://${TUNNEL_ID}.cfargotunnel.com"
echo "$STABLE" > "$URL_FILE"
echo "$STABLE" > "$WIN_URL" 2>/dev/null || true
cp -f "$LOG" "$WIN_LOG" 2>/dev/null || true

echo "OK named tunnel $TUNNEL_NAME ($TUNNEL_ID) running"
echo "CNAME target: ${TUNNEL_ID}.cfargotunnel.com"
echo "status: $(systemctl --user is-active estate-tunnel.service)"
tail -15 "$LOG" 2>/dev/null || true
