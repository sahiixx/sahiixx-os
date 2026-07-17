#!/usr/bin/env bash
set -euo pipefail
TOKEN=$(cat /home/xx/.cloudflared/sahiix-estate.token)
printf 'TUNNEL_TOKEN=%s\n' "$TOKEN" > /home/xx/.cloudflared/sahiix-estate.env
chmod 600 /home/xx/.cloudflared/sahiix-estate.env

cat > /home/xx/.config/systemd/user/estate-tunnel.service <<'UNIT'
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
systemctl --user restart estate-tunnel.service
sleep 4
systemctl --user is-active estate-tunnel.service
PID=$(systemctl --user show -p MainPID --value estate-tunnel)
echo "pid=$PID"
if [ -n "$PID" ] && [ "$PID" != "0" ]; then
  tr '\0' ' ' < "/proc/$PID/cmdline"; echo
fi
grep -E 'Registered tunnel|Updated to new|ERR' /home/xx/estate-tunnel.log | tail -10
