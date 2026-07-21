/**
 * Local Windows OS-control agent for Jarvis (screen, mouse, keyboard, files…).
 * Cloudflare Pages cannot run PowerShell — prod proxies here via JARVIS_OS_AGENT_URL.
 *
 *   node scripts/jarvis-os-agent.mjs
 *   JARVIS_OS_TOKEN=secret node scripts/jarvis-os-agent.mjs --port 3921
 *
 * Endpoints:
 *   GET  /health
 *   POST /v1/tool   { "name": "screen_capture", "args": {}, "flags": { allowOsControl, allowRawShell } }
 */
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const PORT = Number(process.env.JARVIS_OS_PORT || process.argv.includes("--port")
  ? process.argv[process.argv.indexOf("--port") + 1]
  : 3921) || 3921;
const TOKEN = (process.env.JARVIS_OS_TOKEN || "sahiixx-os-local-agent").replace(/^\uFEFF/, "").trim();
const TESSERACT = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";

function runPs(script, timeoutMs = 30000) {
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: timeoutMs, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    );
    return (out || "").trim();
  } catch (e) {
    const stderr = (e?.stderr ?? "").toString().trim();
    const stdout = (e?.stdout ?? "").toString().trim();
    return `Error: ${stderr || stdout || e?.message || "powershell failed"}`.slice(0, 2000);
  }
}

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

async function screenCapture() {
  const tmp = join(tmpdir(), `jarvis-screen-${randomUUID()}.png`);
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save(${psQuote(tmp)}, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output 'ok'
`;
  const r = runPs(script, 20000);
  if (r.startsWith("Error:") || !existsSync(tmp)) {
    return { result: `screen capture failed: ${r}` };
  }
  let ocr = "";
  try {
    if (existsSync(TESSERACT)) {
      ocr = execFileSync(TESSERACT, [tmp, "stdout", "-l", "eng"], {
        encoding: "utf8",
        timeout: 20000,
        windowsHide: true,
      }).trim();
    } else {
      ocr = "(Tesseract not installed — image only)";
    }
  } catch (e) {
    ocr = `(OCR error: ${e?.message || e})`;
  }
  let b64 = "";
  try {
    b64 = readFileSync(tmp).toString("base64");
  } catch {
    /* ignore */
  }
  try {
    unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  return {
    result: `Screen capture OK.\nOCR text:\n${ocr.slice(0, 3500)}`,
    imageBase64: b64 || undefined,
    mimeType: "image/png",
  };
}

function sysStatus() {
  const script = `
$os = Get-CimInstance Win32_OperatingSystem
$cpu = (Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average
$bat = (Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue)
$disk = Get-PSDrive C | Select-Object @{N='FreeGB';E={[math]::Round($_.Free/1GB,1)}},@{N='UsedGB';E={[math]::Round($_.Used/1GB,1)}}
"RAM: $([math]::Round(($os.FreePhysicalMemory/1MB),1))GB free of $([math]::Round(($os.TotalVisibleMemorySize/1MB),1))GB | CPU: $cpu% | Uptime: $((New-TimeSpan -Start $os.LastBootUpTime).Days)d | Disk C: $($disk.FreeGB)GB free | Battery: $(if($bat){"$($bat.EstimatedChargeRemaining)%"}else{'n/a'})"
`;
  return { result: runPs(script, 15000).slice(0, 800) };
}

function windowList() {
  return {
    result: runPs(
      "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress",
      15000,
    ).slice(0, 2000),
  };
}

function processList() {
  return {
    result: runPs(
      "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 25 Id,ProcessName,@{N='MB';E={[math]::Round($_.WorkingSet64/1MB)}} | ConvertTo-Json -Compress",
      15000,
    ).slice(0, 2000),
  };
}

function volumeSet(args) {
  const level = Math.max(0, Math.min(100, Number(args.level ?? args.percent ?? 50)));
  // Use Windows API via key simulation relative volume is flaky; nircmd-free approach:
  const script = `
$wsh = New-Object -ComObject WScript.Shell
# Approximate set: mute then up - not perfect absolute; report requested level
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class Vol {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
}
'@
# VK_VOLUME_MUTE=0xAD, DOWN=0xAE, UP=0xAF
function Send($vk){ [Vol]::keybd_event($vk,0,0,0); [Vol]::keybd_event($vk,0,2,0) }
# zero by muting then unmuting and bumping
1..50 | ForEach-Object { Send 0xAE }
$steps = [math]::Round(${level} / 2)
1..$steps | ForEach-Object { Send 0xAF }
"Volume set toward ${level}% (approx)"
`;
  return { result: runPs(script, 10000) };
}

function typeText(args) {
  const text = String(args.text ?? "");
  if (!text) return { result: "Error: text required" };
  const escaped = text.replace(/[+^%~(){}\[\]]/g, (m) => `{${m}}`).replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
"typed ${text.length} chars"
`;
  return { result: runPs(script, 15000) };
}

function keySend(args) {
  const keys = String(args.keys ?? args.key ?? "");
  if (!keys) return { result: "Error: keys required" };
  const escaped = keys.replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
"sent keys"
`;
  return { result: runPs(script, 10000) };
}

function appOpen(args) {
  const name = String(args.app ?? args.name ?? args.path ?? "");
  if (!name) return { result: "Error: app required" };
  const script = `Start-Process ${psQuote(name)}; "opened ${name.replace(/'/g, "")}"`;
  return { result: runPs(script, 15000) };
}

function appClose(args) {
  const name = String(args.app ?? args.name ?? args.process ?? "");
  if (!name) return { result: "Error: app/process required" };
  const script = `Get-Process -Name ${psQuote(name.replace(/\.exe$/i, ""))} -ErrorAction SilentlyContinue | Stop-Process -Force; "closed ${name.replace(/'/g, "")}"`;
  return { result: runPs(script, 15000) };
}

function clipboard(args) {
  const op = String(args.action ?? args.op ?? "get").toLowerCase();
  if (op === "set" || op === "write") {
    const t = String(args.text ?? "");
    const script = `Set-Clipboard -Value ${psQuote(t)}; "clipboard set"`;
    return { result: runPs(script, 10000) };
  }
  return { result: runPs("Get-Clipboard", 10000).slice(0, 2000) };
}

function windowFocus(args) {
  const title = String(args.title ?? args.name ?? "");
  if (!title) return { result: "Error: title required" };
  const script = `
$p = Get-Process | Where-Object { $_.MainWindowTitle -like ${psQuote("*" + title + "*")} } | Select-Object -First 1
if (-not $p) { 'Error: window not found'; exit }
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
[W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
"focused $($p.MainWindowTitle)"
`;
  return { result: runPs(script, 10000) };
}

async function dispatch(name, args, flags) {
  const allowOs = !!flags?.allowOsControl;
  const allowRaw = !!flags?.allowRawShell;
  const needOs = new Set([
    "app_open", "app_close", "type_text", "key_send", "mouse_action",
    "clipboard", "window_focus", "volume_set", "file_delete", "file_move",
    "process_kill", "power_action", "system_setting",
  ]);
  if (needOs.has(name) && !allowOs) {
    return { result: "OS control not enabled on session (allowOsControl=false)." };
  }
  if (name === "win_script" && !allowRaw) {
    return { result: "Raw shell not enabled (allowRawShell=false)." };
  }

  switch (name) {
    case "screen_capture":
      return await screenCapture();
    case "sys_status":
      return sysStatus();
    case "window_list":
      return windowList();
    case "process_list":
      return processList();
    case "volume_set":
      return volumeSet(args);
    case "type_text":
      return typeText(args);
    case "key_send":
      return keySend(args);
    case "app_open":
      return appOpen(args);
    case "app_close":
      return appClose(args);
    case "clipboard":
      return clipboard(args);
    case "window_focus":
      return windowFocus(args);
    case "file_list": {
      const p = String(args.path || "");
      if (!p || p.includes("..")) return { result: "Error: invalid path" };
      return {
        result: runPs(
          `Get-ChildItem -Path ${psQuote(p)} | Select-Object Name,Length,LastWriteTime | ConvertTo-Json -Compress`,
          15000,
        ).slice(0, 2000),
      };
    }
    case "file_read": {
      const p = String(args.path || "");
      if (!p || p.includes("..")) return { result: "Error: invalid path" };
      return {
        result: runPs(
          `$i=Get-Item ${psQuote(p)}; if($i.Length -gt 65536){'Error: too large'} else { Get-Content ${psQuote(p)} -TotalCount 400 -Encoding UTF8 }`,
          15000,
        ).slice(0, 4000),
      };
    }
    case "win_script": {
      const script = String(args.script || "");
      if (/Format-Volume|diskpart|Remove-Item\s+C:\\Windows|rm\s+-rf\s+\//i.test(script)) {
        return { result: "Error: blocked catastrophic pattern" };
      }
      return { result: runPs(script, 60000).slice(0, 4000) };
    }
    default:
      return { result: `Error: tool "${name}" not implemented on local agent (or use full os.ts via npm run jarvis:os-agent:tsx).` };
  }
}

function auth(req) {
  const h = req.headers["authorization"] || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : req.headers["x-jarvis-os-token"] || "";
  return t === TOKEN;
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Jarvis-Os-Token");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, role: "jarvis-os-agent", platform: process.platform, tesseract: existsSync(TESSERACT) }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/tool") {
    if (!auth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    let json;
    try {
      json = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "bad json" }));
      return;
    }
    const name = String(json.name || "");
    const args = json.args && typeof json.args === "object" ? json.args : {};
    const flags = json.flags || {};
    try {
      const out = await dispatch(name, args, flags);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...out }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, result: `Error: ${e?.message || e}` }));
    }
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[jarvis-os-agent] listening on http://127.0.0.1:${PORT}`);
  console.log(`[jarvis-os-agent] token set=${TOKEN.length > 0} tesseract=${existsSync(TESSERACT)}`);
  console.log(`[jarvis-os-agent] POST /v1/tool  GET /health`);
});
