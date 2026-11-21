#!/usr/bin/env bash
# A live origin/process does not establish public tunnel reachability.
# Sourced by recovery scripts; no service or cloud configuration changes here.
estate_public_ok() {
  local url="$1"
  curl -fsS -m 10 "${url%/}/health" >/dev/null 2>&1
}

# Publish only after the same public probe used by the watchdog succeeds.
estate_publish_url() {
  local url="$1" target="$2"
  estate_public_ok "$url" || return 1
  printf '%s\n' "$url" > "$target"
}
