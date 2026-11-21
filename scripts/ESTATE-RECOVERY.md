# Estate bridge recovery findings

Observed 2026-11-05. No production configuration was changed.

## Reproduced failure

The public OS responds normally, but `nexus.estateHealth` returns `ok=false`
with upstream HTTP 530. The configured upstream is a temporary
`trycloudflare.com` address. A direct Windows health probe cannot resolve it.
Cloudflare documents Quick Tunnel URLs as temporary, intended for development:
https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/

Reproduce safely from PowerShell:

```powershell
& C:/Users/sahii/work-audits/lead-system/probe-estate-bridge.ps1
```

The probe returns exit 1 while the public estate bridge is unhealthy.
It never lists leads or changes cloud/service state.

## Local observations

- Ubuntu has no loaded `estate-api` unit (`LoadState=not-found`).
- Ubuntu has no connector at the scripts' expected `~/.local/bin/cloudflared`.
- Both Ubuntu and Kali fail a localhost:3001 health request.
- Kali also fails to establish its systemd user session.
- The scripts' old `/mnt/c/Users/sahii/sahiixx-os` path does not exist.
- The older Node/SQLite estate source exists at `~/projects/sahiix-os`.
  It has not been established as the original production database/service.

## Local fixes prepared

- `estate-health.sh` provides a shared public health probe.
- The healer no longer substitutes a live local PID/origin for public health.
- Quick startup publishes a URL only after its public health check passes;
  failed probes return nonzero and preserve the previous published URL.
- Recovery paths are resolved from the checkout, including the Windows sync
  script path via `wslpath`.

Four offline tests cover public failure with a healthy local origin,
preservation of the published URL after failure, successful publication,
and a trailing slash. Run with Git Bash or WSL:

```bash
bash scripts/tests/estate-health.test.sh
```

## Recovery sequence and acceptance criteria

1. Locate the intended estate origin and database. Do not substitute the old
   sample-seeded estate app or a new empty database for the production origin.
2. Prepare its runtime and a localhost-bound service. Confirm `/health`
   locally without reading customer records.
3. Prepare a persistent named tunnel for the intended origin, rather than
   guessing or reusing a dead temporary URL. This may require an official
   Cloudflare sign-in, a domain, and installation of the connector.
4. Present the exact origin, hostname, service changes and Pages configuration
   changes for review before exposing the service or changing production.
5. After the scoped change is approved, verify public `/health` and rerun the
   OS bridge probe. Acceptance requires `ok=true` from the OS bridge, not just
   a running PID, a local health response, or a new tunnel hostname.

Existing setup scripts can install software, start services, update DNS,
write Pages secrets, or deploy. They were not executed in this diagnosis.
Live lead imports and WhatsApp delivery remain a separate staging test.
