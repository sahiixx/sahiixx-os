# Real-world production tasks against sahiixx-os.pages.dev
param([string]$Base = "https://sahiixx-os.pages.dev")
$ErrorActionPreference = "Stop"
$ts = Get-Date -Format "HHmmss"
$pass = 0; $fail = 0
function Go($name, $block) {
  Write-Host "`n== $name ==" -ForegroundColor Cyan
  try {
    $detail = & $block
    Write-Host "PASS $detail" -ForegroundColor Green
    $script:pass++
  } catch {
    Write-Host "FAIL $($_.Exception.Message)" -ForegroundColor Red
    $script:fail++
  }
}

$loginBody = (@{ json = @{ email = "admin@sahiixx.os"; password = "sahiixx"; client = "real-world-tasks" } } | ConvertTo-Json -Compress -Depth 5)
$login = Invoke-RestMethod "$Base/api/trpc/auth.login" -Method POST -ContentType "application/json" -Body $loginBody -TimeoutSec 30
if (-not $login.result.data.json.success) { throw "login failed" }
$token = $login.result.data.json.token
$H = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

Go "ops" {
  $h = Invoke-RestMethod "$Base/api/health" -TimeoutSec 15
  $r = Invoke-RestMethod "$Base/api/ready" -TimeoutSec 20
  if ($h.status -ne "ok" -or $r.status -ne "ready") { throw "not ready" }
  "v$($h.version) $($r.dbMode)"
}
Go "moduleCounts-live" {
  $m = Invoke-RestMethod "$Base/api/trpc/sahiixx.moduleCounts" -TimeoutSec 20
  $j = $m.result.data.json
  if ($j.source -ne "db") { throw "expected source=db got $($j.source)" }
  "source=db agents=$($j.agents) deals=$($j.deals) contacts=$($j.contacts)"
}
Go "create-signal" {
  $b = "{`"json`":{`"category`":`"ops`",`"severity`":`"high`",`"message`":`"Real-world signal $ts`",`"source`":`"real-world-tasks`"}}"
  $r = Invoke-RestMethod "$Base/api/trpc/sahiixx.signalCreate" -Method POST -Headers $H -Body $b -TimeoutSec 20
  if (-not $r.result.data.json.success) { throw "signal fail" }
  "demo=$($r.result.data.json.demo)"
}
Go "create-campaign" {
  $b = "{`"json`":{`"name`":`"RW Campaign $ts`",`"template`":`"listing-blast`",`"language`":`"English`"}}"
  $r = Invoke-RestMethod "$Base/api/trpc/sahiixx.campaignCreate" -Method POST -Headers $H -Body $b -TimeoutSec 20
  if (-not $r.result.data.json.success) { throw "campaign fail" }
  "demo=$($r.result.data.json.demo)"
}
Go "create-video" {
  $b = "{`"json`":{`"title`":`"RW Video $ts`",`"platform`":`"instagram`",`"status`":`"pending`"}}"
  $r = Invoke-RestMethod "$Base/api/trpc/sahiixx.videoCreate" -Method POST -Headers $H -Body $b -TimeoutSec 20
  if (-not $r.result.data.json.success) { throw "video fail" }
  "demo=$($r.result.data.json.demo)"
}
Go "deal-update" {
  $list = Invoke-RestMethod "$Base/api/trpc/sahiixx.dealList" -TimeoutSec 20
  $d = @($list.result.data.json | Where-Object { $_.dealId -like "RW-*" } | Select-Object -First 1)
  if (-not $d) { $d = @($list.result.data.json | Select-Object -First 1) }
  if (-not $d) { throw "no deals" }
  $b = "{`"json`":{`"id`":$($d.id),`"score`":91,`"status`":`"active`"}}"
  $r = Invoke-RestMethod "$Base/api/trpc/sahiixx.dealUpdate" -Method POST -Headers $H -Body $b -TimeoutSec 20
  if (-not $r.result.data.json.success) { throw "update fail" }
  "id=$($d.id) score=91 demo=$($r.result.data.json.demo)"
}
Go "estate-bridge" {
  $eh = Invoke-RestMethod "$Base/api/trpc/nexus.estateHealth" -TimeoutSec 25
  if (-not $eh.result.data.json.ok) { throw "estate $($eh.result.data.json.error)" }
  $el = Invoke-RestMethod "$Base/api/trpc/nexus.estateLeads" -TimeoutSec 25
  if (-not $el.result.data.json.ok) { throw "leads fail" }
  "healthMs=$($eh.result.data.json.latencyMs) leads=$($el.result.data.json.leads.Count)"
}
Go "workers-ai" {
  $r = Invoke-RestMethod "$Base/api/trpc/system.workersAiProbe" -Method POST -Headers $H -Body '{"json":null}' -TimeoutSec 90
  if (-not $r.result.data.json.ok) { throw $r.result.data.json.error }
  "ms=$($r.result.data.json.latencyMs)"
}
Go "audit-trail" {
  $a = Invoke-RestMethod "$Base/api/trpc/system.activityList?input=%7B%22json%22%3A%7B%22limit%22%3A15%7D%7D" -TimeoutSec 20
  $actions = @($a.result.data.json.events | ForEach-Object { $_.action }) -join ","
  "source=$($a.result.data.json.source) n=$($a.result.data.json.events.Count) [$actions]"
}

Write-Host "`nPASS=$pass FAIL=$fail" -ForegroundColor Yellow
if ($fail -gt 0) { exit 1 }
exit 0
