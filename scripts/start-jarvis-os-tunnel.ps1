# Quick-tunnel the local Jarvis OS agent (port 3921) to trycloudflare.com.
# Requires: agent running (`npm run jarvis:os-agent`), Windows cloudflared.
$ErrorActionPreference = "Stop"
$Port = if ($env:JARVIS_OS_PORT) { [int]$env:JARVIS_OS_PORT } else { 3921 }
$Cf = @(
  "$env:USERPROFILE\.omniroute\cloudflared\bin\cloudflared.exe",
  "C:\Program Files\cloudflared\cloudflared.exe",
  "$env:LOCALAPPDATA\cloudflared\cloudflared.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $Cf) {
  Write-Error "cloudflared.exe not found. Install cloudflared or place it under .omniroute\cloudflared\bin\"
}

# Health check
try {
  $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
  if (-not $h.ok) { throw "agent unhealthy" }
  Write-Host "[jarvis-os-tunnel] agent healthy on :$Port"
} catch {
  Write-Error "OS agent not reachable on :$Port — run: npm run jarvis:os-agent"
}

$Log = Join-Path $env:TEMP "jarvis-os-agent-tunnel.log"
if (Test-Path $Log) { Remove-Item $Log -Force }

Write-Host "[jarvis-os-tunnel] starting cloudflared quick tunnel → http://127.0.0.1:$Port"
$p = Start-Process -FilePath $Cf -ArgumentList @(
  "tunnel", "--url", "http://127.0.0.1:$Port", "--no-autoupdate"
) -RedirectStandardOutput $Log -RedirectStandardError $Log -PassThru -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds(45)
$url = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 1
  if (Test-Path $Log) {
    $txt = Get-Content $Log -Raw -ErrorAction SilentlyContinue
    if ($txt -match "https://[a-zA-Z0-9-]+\.trycloudflare\.com") {
      $url = $Matches[0]
      break
    }
  }
  if ($p.HasExited) {
    Write-Error "cloudflared exited early. Log:`n$(Get-Content $Log -Raw -ErrorAction SilentlyContinue)"
  }
}

if (-not $url) {
  Write-Error "Timed out waiting for trycloudflare URL. Log:`n$(Get-Content $Log -Raw -ErrorAction SilentlyContinue)"
}

Write-Host ""
Write-Host "JARVIS_OS_AGENT_URL=$url"
$tokenHint = if ($env:JARVIS_OS_TOKEN) { $env:JARVIS_OS_TOKEN } else { "sahiixx-os-local-agent" }
Write-Host "JARVIS_OS_TOKEN=$tokenHint"
Write-Host ""
Write-Host "Put secrets (Pages):"
Write-Host "  echo $url | npx wrangler pages secret put JARVIS_OS_AGENT_URL --project-name=sahiixx-os"
Write-Host "  echo TOKEN | npx wrangler pages secret put JARVIS_OS_TOKEN --project-name=sahiixx-os"
Write-Host ""
Write-Host "Keep this process alive (PID $($p.Id)). Ctrl+C here does not kill cloudflared — stop with:"
Write-Host "  Stop-Process -Id $($p.Id)"
Write-Output $url
