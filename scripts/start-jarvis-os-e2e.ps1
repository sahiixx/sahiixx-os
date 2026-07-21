# Start local Jarvis OS agent + quick tunnel for Cloudflare Pages proxy.
# Keep this window open while you use Jarvis screen_capture / OS control from prod.
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

if (-not $env:JARVIS_OS_TOKEN) { $env:JARVIS_OS_TOKEN = "sahiixx-os-local-agent" }
$Port = if ($env:JARVIS_OS_PORT) { [int]$env:JARVIS_OS_PORT } else { 3921 }

# Stop any prior agent on this port (best-effort)
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 400

Write-Host "[e2e] starting jarvis-os-agent on :$Port"
$agentLog = Join-Path $env:TEMP "jarvis-os-agent.log"
$agent = Start-Process -FilePath "node" -ArgumentList "scripts/jarvis-os-agent.mjs" `
  -WorkingDirectory $Root -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $agentLog -RedirectStandardError $agentLog

$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 300
  try {
    $h = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($h.ok) { $ok = $true; break }
  } catch {}
}
if (-not $ok) { throw "Agent failed to start. Log: $agentLog" }
Write-Host "[e2e] agent healthy (PID $($agent.Id))"

# Tunnel
& "$PSScriptRoot\start-jarvis-os-tunnel.ps1"
Write-Host ""
Write-Host "[e2e] After tunnel URL is printed, put secrets (if URL changed):"
Write-Host "  echo URL | npx wrangler pages secret put JARVIS_OS_AGENT_URL --project-name=sahiixx-os"
Write-Host "  echo $env:JARVIS_OS_TOKEN | npx wrangler pages secret put JARVIS_OS_TOKEN --project-name=sahiixx-os"
Write-Host ""
Write-Host "[e2e] In Jarvis chat say: full control e2e  then: screenshot"
Write-Host "Keep agent PID $($agent.Id) + cloudflared running."
