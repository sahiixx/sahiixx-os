# pipeline-agent (:8010) — go-live status & remaining steps

The `:8010` service is **`pipeline-agent`** (Sovereign Agents, uvicorn,
`pipeline_agent.main:app`, v1.1.0) — *not* SQLBot. SQLBot was a wrong-guess
artifact and has been removed. Lives at
`/mnt/c/Users/sahii/Documents/kimi/workspace/sovereign-agents` (that's where
`LIVE_URL.txt` is written too).

## ✅ DONE (this session)

| Step | Status |
|---|---|
| Identify the real `:8010` service | pipeline-agent, launch cmd captured from live PID |
| `pipeline-agent.service` installed + **enabled + active** | `systemctl --user is-active` = active |
| Reboot-persistence | `Linger=yes` → survives WSL/Windows reboot |
| Bind tightened to `127.0.0.1:8010` | (was `0.0.0.0`; tunnel is the public edge now) |
| EnvironmentFile `~/.cloudflared/pipeline-agent.env` (chmod 600) | `ESTATE_API_URL=http://127.0.0.1:3001` |
| Health verified | `curl 127.0.0.1:8010/health` → `{"status":"ok","service":"pipeline-agent","version":"1.1.0"}` |
| `estate-tunnel.service` (named tunnel → :3001) | active + enabled (already reboot-persistent) |
| `estate-public-heal.timer` | disabled (was churning on hotel-WiFi MITM) |

The orphan that held `0.0.0.0:8010` was stopped; the unit now owns the port.

## 🚧 REMAINING — needs your hand (cannot be done from this session)

These need either a browser login or your Cloudflare dashboard. I can't do
them for you.

### Step 3 — one-time `cloudflared` login (creates cert.pem)
```
! wsl -d Ubuntu-24.04 -- bash -lc "~/.local/bin/cloudflared tunnel login"
```
Authorize your zone in the browser. Verify:
```
! wsl -d Ubuntu-24.04 -- bash -lc "ls ~/.cloudflared/cert.pem && ~/.local/bin/cloudflared tunnel list"
```
(cert.pem is currently absent, so `tunnel list` fails today — that's expected.)

### Step 4 — publish `:8010` on a stable hostname **with auth**
**Order matters: Access app FIRST, then ingress — so the endpoint is never briefly open.**

**4a — Cloudflare Access app (the auth gate) — DO FIRST**
Dashboard → Zero Trust → Access → Applications → Add application → Self-hosted:
- Application domain: `pipeline.<your-zone>` (the hostname you'll use in 4b)
- Policy: allow your email (email-OTP) or SSO group
- Save

**4b — ingress rule on the EXISTING tunnel (no new tunnel/token/unit)**
CLI (after Step 3 cert.pem):
```
! wsl -d Ubuntu-24.04 -- bash -lc "TUN=sahiix-estate; ZONE=YOURZONE.example; ~/.local/bin/cloudflared tunnel route dns \"\$TUN\" pipeline.\$ZONE"
```
Then dashboard → Networks → Tunnels → `sahiix-estate` → Public Hostname →
Add: subdomain `pipeline`, domain `<your-zone>`, service `HTTP localhost:8010`,
Save. (Running tunnel auto-picks-up dashboard config; no restart.)

**Verify:**
```
! wsl -d Ubuntu-24.04 -- bash -lc "curl -sI -m 10 https://pipeline.YOURZONE.example/health | head -5"
```
Expect a `302`/`401` to the Access login first; after browser auth, `https://pipeline.<zone>/health` returns the pipeline-agent JSON.

## Security note

pipeline-agent does an `estate_push` to the estate API. Once public, it must
stay behind the Cloudflare Access gate (4a) — do not skip it. The unit binds
`127.0.0.1` precisely so the only public path is the authenticated tunnel.

## Rollback / ops

- Disable the heal timer? Already off. Re-enable on a clean network:
  `systemctl --user enable --now estate-public-heal.timer` (only needed if you
  still use the estate *quick* tunnel — you don't, once 4b is done).
- Restart pipeline-agent: `systemctl --user restart pipeline-agent.service`
- Logs: `journalctl --user -u pipeline-agent.service -f` or `~/pipeline-agent.log`
- Override env (secrets): edit `~/.cloudflared/pipeline-agent.env`, then
  `systemctl --user restart pipeline-agent.service`