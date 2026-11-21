#!/usr/bin/env bash
# Offline contract tests; no services, DNS, tunnels, or credentials used.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/estate-health.sh"
tmp=$(mktemp -d)
trap 'rm -f "$tmp/url"; rmdir "$tmp"' EXIT

curl() {
  local url="${!#}"
  # Local origin is healthy while public routing fails (e.g. HTTP 530).
  [[ "$url" == "http://127.0.0.1:3001/health" ]] && return 0
  [[ "$url" == "https://healthy.fixture.invalid/health" ]] && return 0
  return 22
}

if estate_public_ok 'https://dead.fixture.invalid'; then
  echo 'FAIL: dead public tunnel accepted' >&2; exit 1
fi
echo 'PASS: public failure stays unhealthy despite healthy local origin'

printf '%s\n' 'previous' > "$tmp/url"
if estate_publish_url 'https://dead.fixture.invalid' "$tmp/url"; then
  echo 'FAIL: unhealthy URL published' >&2; exit 1
fi
[[ "$(cat "$tmp/url")" == 'previous' ]]
echo 'PASS: failed public probe preserves previously published URL'

estate_publish_url 'https://healthy.fixture.invalid' "$tmp/url"
[[ "$(cat "$tmp/url")" == 'https://healthy.fixture.invalid' ]]
echo 'PASS: healthy public URL published'

estate_public_ok 'https://healthy.fixture.invalid/'
echo 'PASS: trailing slash handled'
