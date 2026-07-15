# SAHIIXX OS production smoke (no secret values printed)
param(
  [string]$Base = "https://sahiixx-os.pages.dev",
  [string]$Email = "admin@sahiixx.os",
  [string]$Password = "sahiixx"
)
$ErrorActionPreference = "Stop"

function Ok([string]$n) { Write-Host "  OK  $n" -ForegroundColor Green }
function Warn([string]$n) { Write-Host "  WARN $n" -ForegroundColor Yellow }
function Fail([string]$n, [string]$m) {
  Write-Host "  FAIL $n : $m" -ForegroundColor Red
  throw $m
}

Write-Host "Smoke $Base"
$h = Invoke-RestMethod "$Base/api/health" -TimeoutSec 20
if ($h.status -ne "ok") { Fail "health" ($h | ConvertTo-Json -Compress) }
Ok "health v$($h.version)"

$r = Invoke-RestMethod "$Base/api/ready" -TimeoutSec 25
if ($r.status -ne "ready") { Fail "ready" ($r | ConvertTo-Json -Compress) }
Ok "ready $($r.dbMode)"

$e = Invoke-RestMethod "$Base/api/env-check" -TimeoutSec 15
Ok "env-check workersAi=$($e.hasWorkersAi) estateSecret=$($e.secretsPresent.ESTATE_API_URL)"

$s = Invoke-RestMethod "$Base/api/trpc/system.status" -TimeoutSec 30
$j = $s.result.data.json
if ($j.demo) { Fail "demo" "still demo mode" }
Ok "system.status ready demo=false"
Ok "jarvis=$($j.integrations.jarvis.provider)/$($j.integrations.jarvis.model)"
Ok "estate configured=$($j.integrations.estate.configured) ok=$($j.integrations.estate.ok)"

$payload = @{ json = @{ email = $Email; password = $Password; client = "smoke-prod" } } | ConvertTo-Json -Compress -Depth 5
$login = Invoke-RestMethod "$Base/api/trpc/auth.login" -Method POST -ContentType "application/json" -Body $payload -TimeoutSec 30
if (-not $login.result.data.json.success) { Fail "login" "bad credentials" }
Ok "login JWT"
$token = $login.result.data.json.token
$hdr = @{ Authorization = "Bearer $token" }

$db = Invoke-RestMethod "$Base/api/trpc/sahiixx.dbStatus" -TimeoutSec 20
if ($db.result.data.json.demo) { Fail "dbStatus" "demo" }
Ok "dbStatus live"

$agents = Invoke-RestMethod "$Base/api/trpc/sahiixx.agentList" -TimeoutSec 20
Ok "agents=$($agents.result.data.json.Count)"

$nx = Invoke-RestMethod "$Base/api/trpc/nexus.estateConfig" -TimeoutSec 15
Ok "nexus.estateConfig configured=$($nx.result.data.json.configured)"

$eh = Invoke-RestMethod "$Base/api/trpc/nexus.estateHealth" -TimeoutSec 25
if ($eh.result.data.json.ok) { Ok "nexus.estateHealth $($eh.result.data.json.latencyMs)ms" }
else { Warn "estateHealth: $($eh.result.data.json.error)" }

$el = Invoke-RestMethod "$Base/api/trpc/nexus.estateLeads" -TimeoutSec 25
if ($el.result.data.json.ok) { Ok "nexus.estateLeads n=$($el.result.data.json.leads.Count)" }
else { Warn "estateLeads: $($el.result.data.json.error)" }

try {
  $ai = Invoke-RestMethod "$Base/api/trpc/system.workersAiProbe" -Method POST -ContentType "application/json" -Body '{"json":null}' -Headers $hdr -TimeoutSec 90
  if ($ai.result.data.json.ok) { Ok "workersAiProbe $($ai.result.data.json.latencyMs)ms" }
  else { Warn "ai: $($ai.result.data.json.error)" }
} catch { Warn "aiProbe $($_.Exception.Message)" }

Write-Host "SMOKE PASS" -ForegroundColor Green
