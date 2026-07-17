#Requires -Version 5.1
# Put ESTATE_API_URL, redeploy Pages (secret snapshot), probe prod.
param(
  [string]$Url = "",
  [string]$Project = "sahiixx-os",
  [switch]$SkipDeploy
)
$ErrorActionPreference = "Stop"
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue

$Root = "C:\Users\sahii\sahiixx-os"
if (-not $Url) {
  $f = Join-Path $Root "scripts\estate-tunnel.url"
  if (-not (Test-Path $f)) { throw "No URL file $f - run start-estate-public-quick.sh first" }
  $Url = (Get-Content $f -Raw).Trim()
}
if ($Url -notmatch '^https://') { throw "Bad URL: $Url" }
$hostn = ([Uri]$Url).Host

# Health: try normal, then Resolve-DnsName@1.1.1.1 + curl --resolve (router DNS often NXDOMAINs trycloudflare)
$ok = $false
$last = ""
for ($i = 0; $i -lt 10; $i++) {
  try {
    $h = Invoke-RestMethod "$Url/health" -TimeoutSec 12
    if ($h.status -eq "ok") { $ok = $true; break }
    $last = ($h | ConvertTo-Json -Compress)
  } catch {
    $last = $_.Exception.Message
    try {
      $r = Resolve-DnsName $hostn -Type A -Server 1.1.1.1 -ErrorAction Stop
      $ip = ($r | Where-Object { $_.IPAddress } | Select-Object -First 1).IPAddress
      if ($ip) {
        $body = & curl.exe -sS -m 15 --resolve "${hostn}:443:${ip}" "$Url/health" 2>$null
        if ($body -match '"status"\s*:\s*"ok"') { $ok = $true; break }
        $last = "resolve-health: $body"
      }
    } catch {
      $last = $_.Exception.Message
    }
  }
  Start-Sleep -Seconds 2
}
if (-not $ok) { throw "Public tunnel unhealthy ($Url): $last" }

Set-Location $Root
[IO.File]::WriteAllText((Join-Path $Root "scripts\estate-tunnel.url"), $Url)
$Url | npx --yes wrangler pages secret put ESTATE_API_URL --project-name=$Project
Write-Host "ESTATE_API_URL -> $Url"

if (-not $SkipDeploy) {
  if (-not (Test-Path "dist\public\index.html")) {
    Write-Host "Building..."
    npm run build
  }
  Write-Host "Redeploying Pages so secret snapshot updates..."
  npx --yes wrangler pages deploy dist/public --project-name=$Project --branch=main --commit-dirty=true
}

Start-Sleep -Seconds 5
$eh = Invoke-RestMethod "https://sahiixx-os.pages.dev/api/trpc/nexus.estateHealth" -TimeoutSec 35
$j = $eh.result.data.json
if ($j.ok) {
  Write-Host "PROD estateHealth OK $($j.latencyMs)ms url=$($j.url)" -ForegroundColor Green
} else {
  Write-Host "PROD estateHealth FAIL: $($j.error) url=$($j.url)" -ForegroundColor Yellow
  exit 2
}
