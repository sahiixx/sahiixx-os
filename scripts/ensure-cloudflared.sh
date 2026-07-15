#!/usr/bin/env bash
set -euo pipefail
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "installing cloudflared..."
  curl -fsSL -o /tmp/cloudflared.deb \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  if command -v sudo >/dev/null 2>&1; then
    sudo dpkg -i /tmp/cloudflared.deb || sudo apt-get install -y -f
  else
    dpkg -i /tmp/cloudflared.deb || apt-get install -y -f
  fi
fi
cloudflared --version
systemctl --user start estate-api 2>/dev/null || true
curl -fsS -m 3 http://127.0.0.1:3001/health
echo
echo "estate_ok"
