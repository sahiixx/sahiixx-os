#!/usr/bin/env bash
set -euo pipefail
if command -v cloudflared >/dev/null 2>&1; then
  cloudflared --version
  exit 0
fi
echo "Downloading cloudflared..."
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) DEB_ARCH=amd64 ;;
  aarch64|arm64) DEB_ARCH=arm64 ;;
  *) echo "unsupported arch $ARCH"; exit 1 ;;
esac
curl -fsSL -o /tmp/cloudflared.deb \
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${DEB_ARCH}.deb"
if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  sudo dpkg -i /tmp/cloudflared.deb || sudo apt-get install -y -f
elif [ "$(id -u)" = "0" ]; then
  dpkg -i /tmp/cloudflared.deb || apt-get install -y -f
else
  # user-local binary fallback
  curl -fsSL -o "$HOME/.local/bin/cloudflared" \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${DEB_ARCH}"
  mkdir -p "$HOME/.local/bin"
  chmod +x "$HOME/.local/bin/cloudflared"
  export PATH="$HOME/.local/bin:$PATH"
fi
export PATH="$HOME/.local/bin:$PATH"
cloudflared --version
