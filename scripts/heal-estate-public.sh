#!/usr/bin/env bash
# Keep interim trycloudflare public bridge healthy; optionally sync Pages secret + redeploy.
# Named tunnel (estate-tunnel.service) is separate — public hostname needs a CF zone.
#
# Env:
#   SYNC_PAGES=1     put ESTATE_API_URL + redeploy when URL changes (Windows wrangler)
#   FORCE=1          always restart quick tunnel
#   FORCE_SYNC=1     re-put secret even if URL unchanged
set -euo pipefail

ROOT="/mnt/c/Users/sahii/sahiixx-os"
LOG="$ROOT/scripts/estate-public-quick.log"
PIDF="$ROOT/scripts/estate-public-quick.pid"
URLF="$ROOT/scripts/estate-tunnel.url"
HEAL_LOG="$ROOT/scripts/estate-public-heal.log"
START_SCRIPT="$ROOT/scripts/start-estate-public-quick.sh"
SYNC_PS1="C:\\\\Users\\\\sahii\\\\sahiixx-os\\\\scripts\\\\sync-estate-secret.ps1"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$HEAL_LOG"; }

public_ok() {
  local u="$1"
  # Prefer direct curl; fall back to origin+pid when local DNS NXDOMAINs trycloudflare
  if curl -fsS -m 10 "$u/health" >/dev/null 2>&1; then
    return 0
  fi
  if [[ -f "$PIDF" ]]; then
    local pid
    pid=$(tr -d ' \r\n' < "$PIDF" || true)
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      if curl -fsS -m 4 http://127.0.0.1:3001/health >/dev/null 2>&1; then
        return 0
      fi
    fi
  fi
  return 1
}

systemctl --user start estate-api 2>/dev/null || true
systemctl --user start estate-tunnel 2>/dev/null || true

if ! curl -fsS -m 4 http://127.0.0.1:3001/health >/dev/null 2>&1; then
  log "FAIL estate-api :3001 unhealthy"
  exit 1
fi

need_restart=0
if [[ "${FORCE:-0}" == "1" ]]; then
  need_restart=1
elif [[ ! -f "$URLF" ]] || [[ -z "$(tr -d '\r\n' < "$URLF" 2>/dev/null || true)" ]]; then
  need_restart=1
else
  URL=$(tr -d '\r\n' < "$URLF")
  if ! public_ok "$URL"; then
    log "public URL dead or connector down: $URL"
    need_restart=1
  fi
fi

OLD_URL=""
[[ -f "$URLF" ]] && OLD_URL=$(tr -d '\r\n' < "$URLF" || true)

if [[ "$need_restart" == "1" ]]; then
  log "restarting public quick tunnel..."
  bash "$START_SCRIPT" | tee -a "$HEAL_LOG"
fi

NEW_URL=$(tr -d '\r\n' < "$URLF" 2>/dev/null || true)
if [[ -z "$NEW_URL" ]]; then
  log "FAIL no public URL written"
  exit 1
fi

if public_ok "$NEW_URL"; then
  log "public OK $NEW_URL"
else
  log "FAIL public still unhealthy: $NEW_URL"
  exit 1
fi

# Sync + redeploy when URL changed (or forced). Uses Windows PowerShell script.
if [[ "${SYNC_PAGES:-0}" == "1" ]] && [[ "$NEW_URL" != "$OLD_URL" || "${FORCE_SYNC:-0}" == "1" || "$need_restart" == "1" ]]; then
  if command -v powershell.exe >/dev/null 2>&1; then
    log "syncing Pages secret + redeploy for $NEW_URL ..."
    if powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$SYNC_PS1" -Url "$NEW_URL" >>"$HEAL_LOG" 2>&1; then
      log "Pages sync OK"
    else
      log "WARN Pages sync failed — run: npm run tunnel:estate:sync"
    fi
  else
    log "WARN no powershell.exe — run on Windows: npm run tunnel:estate:sync"
  fi
elif [[ "${SYNC_PAGES:-0}" == "1" ]]; then
  log "URL unchanged and connector healthy; skip secret put"
fi

exit 0
