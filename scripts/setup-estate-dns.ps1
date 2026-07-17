#Requires -Version 5.1
<#
.SYNOPSIS
  Point a hostname on a Cloudflare zone at the sahiix-estate named tunnel,
  set remote ingress, and put ESTATE_API_URL on Pages.

.PARAMETER Hostname
  Full public hostname, e.g. estate.example.com (zone must already be on this Cloudflare account).

.EXAMPLE
  .\setup-estate-dns.ps1 -Hostname estate.example.com
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Hostname
)

$ErrorActionPreference = "Stop"
# Prefer Wrangler OAuth — do not use broken User CLOUDFLARE_API_TOKEN
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue

$AccountId = "37009577de6a11bcf8747f72ce923a4f"
$TunnelId  = "4d78e2cb-36d3-4785-9e7d-a84d1181f651"
$Project   = "sahiixx-os"
$Root      = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "package.json"))) { $Root = "C:\Users\sahii\sahiixx-os" }

$toml = Get-Content "$env:USERPROFILE\.wrangler\config\default.toml" -Raw
if ($toml -notmatch 'oauth_token\s*=\s*"([^"]+)"') {
  throw "No wrangler oauth_token. Run: npx wrangler login"
}
$ot = $Matches[1]
$h = @{ Authorization = "Bearer $ot"; "Content-Type" = "application/json" }

# Resolve zone from hostname
$zones = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones?per_page=50" -Headers $h
if (-not $zones.result -or $zones.result.Count -eq 0) {
  throw "No Cloudflare zones on this account. Add a domain first: https://dash.cloudflare.com → Add a site"
}
$zone = $zones.result | Where-Object { $Hostname -eq $_.name -or $Hostname.EndsWith("." + $_.name) } | Select-Object -First 1
if (-not $zone) {
  $names = ($zones.result | ForEach-Object { $_.name }) -join ", "
  throw "Hostname $Hostname does not match any zone ($names)"
}
Write-Host "Zone: $($zone.name) ($($zone.id))"

# Upsert CNAME → <tunnel-id>.cfargotunnel.com (proxied)
$cnameTarget = "$TunnelId.cfargotunnel.com"
$existing = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$($zone.id)/dns_records?type=CNAME&name=$Hostname" -Headers $h
$body = @{
  type    = "CNAME"
  name    = $Hostname
  content = $cnameTarget
  proxied = $true
  ttl     = 1
} | ConvertTo-Json

if ($existing.result -and $existing.result.Count -gt 0) {
  $rid = $existing.result[0].id
  $null = Invoke-RestMethod -Method PUT -Uri "https://api.cloudflare.com/client/v4/zones/$($zone.id)/dns_records/$rid" -Headers $h -Body $body
  Write-Host "Updated CNAME $Hostname → $cnameTarget"
} else {
  $null = Invoke-RestMethod -Method POST -Uri "https://api.cloudflare.com/client/v4/zones/$($zone.id)/dns_records" -Headers $h -Body $body
  Write-Host "Created CNAME $Hostname → $cnameTarget"
}

# Remote tunnel ingress: hostname → estate :3001
$ingress = @{
  config = @{
    ingress = @(
      @{
        hostname = $Hostname
        service  = "http://127.0.0.1:3001"
        originRequest = @{ connectTimeout = 30 }
      }
      @{ service = "http_status:404" }
    )
  }
} | ConvertTo-Json -Depth 8
$cfg = Invoke-RestMethod -Method PUT -Uri "https://api.cloudflare.com/client/v4/accounts/$AccountId/cfd_tunnel/$TunnelId/configurations" -Headers $h -Body $ingress
if (-not $cfg.success) { throw "ingress config failed: $($cfg | ConvertTo-Json -Compress)" }
Write-Host "Tunnel ingress: $Hostname → http://127.0.0.1:3001"

# Pages secret
$url = "https://$Hostname"
Set-Location $Root
$url | npx --yes wrangler pages secret put ESTATE_API_URL --project-name=$Project
Write-Host "Pages secret ESTATE_API_URL = $url"

# Local caches
$url | Set-Content (Join-Path $PSScriptRoot "estate-tunnel.url") -NoNewline
Write-Host ""
Write-Host "Done. Public estate URL: $url"
Write-Host "Probe: curl -sS $url/health"
Write-Host "If tunnel connector is down: wsl -d Ubuntu-24.04 -- bash /mnt/c/Users/sahii/sahiixx-os/scripts/install-named-estate-tunnel.sh"
