// Windows OS-control tool layer for Jarvis — the "100x" device control.
//
// Everything runs via powershell.exe + .NET (no native npm deps; this box has no
// build toolchain). The Hono dev server runs ON the box so it can reach
// powershell.exe; a Cloudflare Worker cannot. LOCAL-DEV ONLY.
//
// SAFETY MODEL (this is a no-backup-safety-net box — see home-root CLAUDE.md):
//   • Bounded tools NEVER let the model write PowerShell. Each tool builds a
//     hardcoded script template; user-supplied text only enters as psQuote'd
//     single-quoted literals, which are fully inert in PowerShell.
//   • Three tiers: read-only (no gate), mutating (session.allowOsControl),
//     destructive (allowOsControl + a per-op CONFIRM click via registerPendingOp).
//   • win_script is the ONLY place the model writes free PowerShell — behind its
//     own allowRawShell flag, a hard blocklist, a dry-run preview, and CONFIRM.
//
// See the plan: C:\Users\sahii\.claude\plans\recursive-drifting-key.md

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { JarvisSession, SSEEvent, ToolDef, ToolExecResult } from "./types";
import { registerPendingOp } from "./approvals";

const TESSERACT = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
const SRC_DIR = process.cwd(); // sahiixx-os project root — protect from file tools
const PROTECTED_ROOTS = ["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)", "C:\\ProgramData"];
const CRITICAL_PROCESSES = ["lsass", "wininit", "services", "smss", "csrss", "winlogon", "svchost", "explorer"];

// ── PowerShell runner ───────────────────────────────────────────────────────
export interface PsOptions { timeoutMs?: number; maxBuffer?: number }

/** Run a PowerShell script via execFile (no shell layer — argv is literal, same
 *  safety pattern as the verified runWsl). Returns stdout, or "Error: …". */
export function runPowershell(script: string, opts: PsOptions = {}): string {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const maxBuffer = opts.maxBuffer ?? 2 * 1024 * 1024;
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: timeoutMs,
      encoding: "utf8",
      maxBuffer,
      windowsHide: true,
    });
    return (out || "").trim();
  } catch (e: any) {
    const stderr = (e?.stderr ?? "").toString().trim();
    const stdout = (e?.stdout ?? "").toString().trim();
    return `Error: ${stderr || stdout || e?.message || "powershell command failed"}`.slice(0, 2000);
  }
}

/** Quote a string as a PowerShell single-quoted literal. Single-quoted strings
 *  in PowerShell are fully literal — only ' is special, escaped by doubling.
 *  Everything the model passes (file paths, text to type, app names, window
 *  titles) goes through here, so it becomes inert data, never executable code. */
export function psQuote(s: string): string {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/** Escape SendKeys metacharacters so text is typed literally (applied BEFORE psQuote). */
function escapeSendKeys(s: string): string {
  return s.replace(/[+^%~(){}\[\]]/g, (m) => `{${m}}`);
}

// ── Path validation ─────────────────────────────────────────────────────────
export function validatePath(p: string): { ok: boolean; abs: string; error?: string } {
  if (!p || typeof p !== "string") return { ok: false, abs: "", error: "Path required." };
  if (p.includes("..")) return { ok: false, abs: "", error: "Parent-directory traversal (..) is not allowed." };
  if (!isAbsolute(p)) return { ok: false, abs: "", error: "Path must be absolute." };
  const abs = resolve(p);
  const lower = abs.toLowerCase();
  for (const root of PROTECTED_ROOTS) {
    if (lower === root.toLowerCase() || lower.startsWith(root.toLowerCase() + "\\")) {
      return { ok: false, abs, error: `Path under protected root: ${root}` };
    }
  }
  const userProfile = process.env.USERPROFILE ?? "";
  if (userProfile && lower === userProfile.toLowerCase()) {
    return { ok: false, abs, error: "Cannot operate on the user profile root." };
  }
  if (/\\.claude(\\|$)/i.test(abs)) return { ok: false, abs, error: "Cannot operate on the .claude directory." };
  if (/\\.ssh(\\|$)/i.test(abs)) return { ok: false, abs, error: "Cannot operate on the .ssh directory." };
  const srcLower = SRC_DIR.toLowerCase();
  if (lower === srcLower || lower.startsWith(srcLower + "\\")) {
    return { ok: false, abs, error: "Cannot operate on the sahiixx-os source directory." };
  }
  if (/\\\$Recycle\.Bin(\\|$)/i.test(abs)) return { ok: false, abs, error: "Cannot operate on the Recycle Bin." };
  return { ok: true, abs };
}

// ── Tool schema ─────────────────────────────────────────────────────────────
export const OS_TOOLS: ToolDef[] = [
  // Tier 1 — read-only
  {
    type: "function",
    function: {
      name: "screen_capture",
      description: "Capture the screen, OCR it with Tesseract, and return the on-screen text. The user also sees the screenshot inline. Use this to READ what's currently on screen before acting on something visual.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "sys_status",
      description: "Read-only system status: CPU load, free/used RAM, disk free space, battery, uptime, and up network interfaces.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "window_list",
      description: "List currently open application windows (processes that have a visible window title). Read-only.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "process_list",
      description: "List the top 20 running processes by memory usage. Read-only.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "file_list",
      description: "List the contents of a directory (name, size, modified time). Read-only. Path must be absolute and not under a protected root.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute directory path to list." } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_read",
      description: "Read a small text file (max 64KB, first 400 lines). Read-only. Path must be absolute and not under a protected root.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute file path to read." } },
        required: ["path"],
      },
    },
  },
  // Tier 2 — mutating, low-risk (require allowOsControl)
  {
    type: "function",
    function: {
      name: "app_open",
      description: "Launch an application by name (matched against installed Start apps) or by path. Requires 'Allow OS control'.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "App name (e.g. 'Notepad', 'Calculator') or absolute path to an .exe." } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "app_close",
      description: "Gracefully close an application window by its exact title (sends WM_CLOSE, not a force kill). Requires 'Allow OS control'.",
      parameters: {
        type: "object",
        properties: { title: { type: "string", description: "Exact window title to close." } },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description: "Type a string of text into whichever window currently has focus (via SendKeys). Requires 'Allow OS control'.",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "Text to type." } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "key_send",
      description: "Send a named key or key combination to the focused window. Requires 'Allow OS control'. Allowed: Enter, Escape, Tab, Backspace, Delete, Left, Right, Up, Down, Home, End, PageUp, PageDown, F1..F12, Space, Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+Z, Ctrl+A, Ctrl+S, Ctrl+P, Alt+Tab, Alt+F4, Win, Win+D, Win+L, Win+E, VolumeUp, VolumeDown, VolumeMute, MediaPlayPause, MediaNext, MediaPrev.",
      parameters: {
        type: "object",
        properties: { key: { type: "string", description: "Named key/combination from the allowed list." } },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mouse_action",
      description: "Move or click the mouse. Requires 'Allow OS control'.",
      parameters: {
        type: "object",
        properties: {
          verb: { type: "string", enum: ["move", "click", "right_click", "double_click"] },
          x: { type: "number", description: "Screen X coordinate (0..screen width)." },
          y: { type: "number", description: "Screen Y coordinate (0..screen height)." },
        },
        required: ["verb", "x", "y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clipboard",
      description: "Get or set the clipboard text. Requires 'Allow OS control'.",
      parameters: {
        type: "object",
        properties: {
          verb: { type: "string", enum: ["get", "set"] },
          text: { type: "string", description: "Text to put on the clipboard (only for verb=set)." },
        },
        required: ["verb"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "window_focus",
      description: "Bring a window to the foreground by its exact title. Requires 'Allow OS control'.",
      parameters: {
        type: "object",
        properties: { title: { type: "string", description: "Exact window title to focus." } },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "volume_set",
      description: "Control the master volume: mute, up, or down (reliable via media keys), or set to an absolute percentage (best-effort; may be unavailable on some hosts). Requires 'Allow OS control'.",
      parameters: {
        type: "object",
        properties: {
          verb: { type: "string", enum: ["mute", "up", "down", "set"] },
          percent: { type: "number", description: "Target volume 0..100 (only for verb=set)." },
        },
        required: ["verb"],
      },
    },
  },
  // Tier 3 — destructive (require allowOsControl + per-op CONFIRM)
  {
    type: "function",
    function: {
      name: "file_delete",
      description: "Delete a file or directory. By default it is a SOFT delete (moved to a jarvis-trash folder under %TEMP%, recoverable). With permanent:true it is removed permanently. REQUIRES a CONFIRM click. Path must be absolute and not under a protected root.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to delete." },
          permanent: { type: "boolean", description: "If true, permanently delete instead of soft-delete." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_move",
      description: "Move or rename a file/directory. REQUIRES a CONFIRM click. Both paths must be absolute and not under a protected root.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", description: "Absolute source path." },
          destination: { type: "string", description: "Absolute destination path." },
        },
        required: ["source", "destination"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "process_kill",
      description: "Force-kill a running process by name. REQUIRES a CONFIRM click. Critical Windows processes are refused.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Process name (with or without .exe)." } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "power_action",
      description: "Lock, sleep, shut down, or restart the PC. Lock runs immediately; sleep/shutdown/restart REQUIRE a CONFIRM click.",
      parameters: {
        type: "object",
        properties: { verb: { type: "string", enum: ["lock", "sleep", "shutdown", "restart"] } },
        required: ["verb"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "system_setting",
      description: "Toggle or set a system setting. dark_mode and brightness run immediately; wifi, bluetooth, airplane_mode REQUIRE a CONFIRM click (they can disrupt connectivity).",
      parameters: {
        type: "object",
        properties: {
          setting: { type: "string", enum: ["dark_mode", "brightness", "wifi", "bluetooth", "airplane_mode"] },
          value: { type: "string", description: "dark_mode: 'on'|'off'; brightness: '0'..'100'; wifi/bluetooth/airplane_mode: 'on'|'off'." },
        },
        required: ["setting", "value"],
      },
    },
  },
  // Raw escape hatch
  {
    type: "function",
    function: {
      name: "win_script",
      description: "RAW POWERSHELL ESCAPE HATCH. Runs an arbitrary PowerShell script you write. Requires the user to enable 'Allow raw shell'. The script is shown to the user verbatim in a dry-run preview and only runs after they click CONFIRM. Catastrophic patterns (Format-Volume, diskpart, Remove-Item C:\\Windows, etc.) are always refused. Always prefer a specific bounded tool over win_script.",
      parameters: {
        type: "object",
        properties: {
          script: { type: "string", description: "The PowerShell script to run." },
          description: { type: "string", description: "One-line plain-English summary of what the script does (shown on the CONFIRM button)." },
        },
        required: ["script", "description"],
      },
    },
  },
];

// ── Dispatcher ──────────────────────────────────────────────────────────────
export async function executeOsTool(name: string, args: Record<string, unknown>, session: JarvisSession): Promise<ToolExecResult> {
  try {
    switch (name) {
      // Tier 1 — read-only, always run
      case "screen_capture": return await screenCapture();
      case "sys_status": return { result: sysStatus() };
      case "window_list": return { result: runPowershell(WINDOW_LIST).slice(0, 1500) };
      case "process_list": return { result: runPowershell(PROCESS_LIST).slice(0, 1500) };
      case "file_list": return { result: fileList(args) };
      case "file_read": return { result: fileRead(args) };
      // Tier 2 — require allowOsControl
      case "app_open": return reqOs(session, "app_open", () => appOpen(args));
      case "app_close": return reqOs(session, "app_close", () => appClose(args));
      case "type_text": return reqOs(session, "type_text", () => typeText(args));
      case "key_send": return reqOs(session, "key_send", () => keySend(args));
      case "mouse_action": return reqOs(session, "mouse_action", () => mouseAction(args));
      case "clipboard": return reqOs(session, "clipboard", () => clipboard(args));
      case "window_focus": return reqOs(session, "window_focus", () => windowFocus(args));
      case "volume_set": return reqOs(session, "volume_set", () => volumeSet(args));
      // Tier 3 — require allowOsControl + per-op CONFIRM
      case "file_delete": return reqOs(session, "file_delete", () => fileDelete(args, session));
      case "file_move": return reqOs(session, "file_move", () => fileMove(args, session));
      case "process_kill": return reqOs(session, "process_kill", () => processKill(args, session));
      case "power_action": return reqOs(session, "power_action", () => powerAction(args, session));
      case "system_setting": return reqOs(session, "system_setting", () => systemSetting(args, session));
      // Raw shell — separate flag
      case "win_script": return winScript(args, session);
      default: return { result: `Error: unknown tool "${name}".` };
    }
  } catch (e: any) {
    return { result: `Error: ${e?.message ?? String(e)}` };
  }
}

function reqOs(s: JarvisSession, tool: string, run: () => ToolExecResult): ToolExecResult {
  if (!s.allowOsControl) return { result: `OS control is not enabled. Ask the user to toggle "Allow OS control" on, then retry ${tool}.` };
  return run();
}

// ── Tier 1 implementations ───────────────────────────────────────────────────

const WINDOW_LIST =
  "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress";
const PROCESS_LIST =
  "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 20 Id,ProcessName,@{N='MB';E={[math]::Round($_.WorkingSet64/1MB)}} | ConvertTo-Json -Compress";
const SYS_STATUS = `
$os = Get-CimInstance Win32_OperatingSystem
$cpu = (Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average
$bat = (Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue)
$net = (Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 3 InterfaceAlias)
$disk = Get-PSDrive C | Select-Object @{N='FreeGB';E={[math]::Round($_.Free/1GB,1)}},@{N='UsedGB';E={[math]::Round($_.Used/1GB,1)}}
"RAM: $([math]::Round(($os.FreePhysicalMemory/1MB),1))GB free of $([math]::Round(($os.TotalVisibleMemorySize/1MB),1))GB | CPU: $cpu% | Uptime: $((New-TimeSpan -Start $os.LastBootUpTime).Days)d$((New-TimeSpan -Start $os.LastBootUpTime).Hours)h | Disk C: $($disk.FreeGB)GB free / $($disk.UsedGB)GB used | Battery: $(if($bat){"$($bat.EstimatedChargeRemaining)%"}else{'n/a'}) | Net: $(($net.InterfaceAlias) -join ', ')"
`.trim();

function sysStatus(): string {
  return runPowershell(SYS_STATUS, { timeoutMs: 15000 }).slice(0, 600);
}

function fileList(args: Record<string, unknown>): string {
  const v = validatePath(String(args.path ?? ""));
  if (!v.ok) return `Error: ${v.error}`;
  const script = `Get-ChildItem -Path ${psQuote(v.abs)} | Select-Object Name,Length,LastWriteTime | ConvertTo-Json -Compress`;
  return runPowershell(script, { timeoutMs: 15000 }).slice(0, 1500) || "Empty directory.";
}

function fileRead(args: Record<string, unknown>): string {
  const v = validatePath(String(args.path ?? ""));
  if (!v.ok) return `Error: ${v.error}`;
  const p = psQuote(v.abs);
  // Reject files > 64KB; read first 400 lines as UTF-8 text.
  const script = `$i = Get-Item -Path ${p}; if ($i.Length -gt 65536) { 'Error: file too large (>'+'64KB)' } else { Get-Content -Path ${p} -TotalCount 400 -Encoding UTF8 }`;
  return runPowershell(script, { timeoutMs: 15000 }).slice(0, 4000) || "(empty file)";
}

async function screenCapture(): Promise<ToolExecResult> {
  const tmp = join(tmpdir(), `jarvis-screen-${randomUUID()}.png`);
  // PowerShell captures the primary screen to the temp PNG.
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save('${tmp.replace(/'/g, "''")}')
"$($b.Width)|$($b.Height)"
`.trim();
  const sizeOut = runPowershell(script, { timeoutMs: 15000 });
  if (sizeOut.startsWith("Error:")) return { result: `Error: screen capture failed: ${sizeOut.slice(0, 200)}` };
  if (!existsSync(tmp)) return { result: "Error: screen capture wrote no file." };
  let base64 = "";
  let ocr = "";
  try {
    const png = readFileSync(tmp);
    base64 = png.toString("base64");
    const [w, h] = sizeOut.split("|").map((n) => parseInt(n, 10) || 0);
    // OCR via Tesseract (installed at TESSERACT, on PATH).
    const tesseractBin = existsSync(TESSERACT) ? TESSERACT : "tesseract";
    try {
      ocr = execFileSync(tesseractBin, [tmp, "stdout", "-l", "eng"], { encoding: "utf8", timeout: 15000, windowsHide: true }).trim();
    } catch {
      ocr = "(OCR unavailable)";
    }
    const event: SSEEvent = { event: "screen", data: { seq: 0, mime: "image/png", base64, width: w, height: h } };
    const text = (ocr || "(no text detected)").slice(0, 2000);
    return { result: `Screen captured (${w}x${h}). OCR text:\n${text}`, events: [event] };
  } finally {
    try { unlinkSync(tmp); } catch { /* best-effort cleanup */ }
  }
}

// ── Tier 2 implementations ──────────────────────────────────────────────────

function appOpen(args: Record<string, unknown>): ToolExecResult {
  const name = String(args.name ?? "").trim();
  if (!name) return { result: "Error: app_open requires a 'name'." };
  // Try matching installed Start apps by name; fall back to treating `name` as a path/exe.
  const matchScript = `Get-StartApps | Where-Object { $_.Name -like ${psQuote("*" + name + "*")} } | Select-Object Name,AppID | ConvertTo-Json -Compress`;
  const matchOut = runPowershell(matchScript, { timeoutMs: 15000 });
  let appId: string | null = null;
  try {
    const parsed = JSON.parse(matchOut);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (first?.AppID) appId = String(first.AppID);
  } catch { /* no match — fall through */ }
  let script: string;
  if (appId) {
    if (appId.includes("!")) {
      // UWP / Store app — launch via shell:AppsFolder
      script = `Start-Process -FilePath ${psQuote("shell:AppsFolder\\" + appId)}`;
    } else {
      script = `Start-Process -FilePath ${psQuote(appId)}`;
    }
  } else {
    // Treat `name` as a path or executable to start directly.
    script = `Start-Process -FilePath ${psQuote(name)}`;
  }
  const out = runPowershell(script, { timeoutMs: 15000 });
  if (out.startsWith("Error:")) return { result: `Error: could not open app: ${out.slice(0, 200)}` };
  return { result: `Opened ${appId ?? name}.` };
}

// C# P/Invoke helper for window operations (compiled once per session via the
// PSTypeName guard). Used by app_close and window_focus.
const WIN_HELPER = `
if (-not ([System.Management.Automation.PSTypeName]'JvWin').Type) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class JvWin {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
}
'@
}
`.trim();

function appClose(args: Record<string, unknown>): ToolExecResult {
  const title = String(args.title ?? "").trim();
  if (!title) return { result: "Error: app_close requires a 'title'." };
  const script = `${WIN_HELPER}\n$h = [JvWin]::FindWindow($null, ${psQuote(title)}); if ($h -eq [IntPtr]::Zero) { 'Error: no window with that title' } else { [void][JvWin]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); 'closed' }`;
  const out = runPowershell(script, { timeoutMs: 15000 });
  if (out.startsWith("Error:")) return { result: out.slice(0, 400) };
  return { result: `Sent close to window "${title}".` };
}

function windowFocus(args: Record<string, unknown>): ToolExecResult {
  const title = String(args.title ?? "").trim();
  if (!title) return { result: "Error: window_focus requires a 'title'." };
  const script = `${WIN_HELPER}\n$h = [JvWin]::FindWindow($null, ${psQuote(title)}); if ($h -eq [IntPtr]::Zero) { 'Error: no window with that title' } else { [void][JvWin]::ShowWindow($h, 9); [void][JvWin]::SetForegroundWindow($h); 'focused' }`;
  const out = runPowershell(script, { timeoutMs: 15000 });
  if (out.startsWith("Error:")) return { result: out.slice(0, 400) };
  return { result: `Focused window "${title}".` };
}

function typeText(args: Record<string, unknown>): ToolExecResult {
  const text = String(args.text ?? "");
  if (!text) return { result: "Error: type_text requires 'text'." };
  const sk = escapeSendKeys(text);
  const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${psQuote(sk)})`;
  const out = runPowershell(script, { timeoutMs: 15000 });
  if (out.startsWith("Error:")) return { result: `Error: type failed: ${out.slice(0, 200)}` };
  return { result: `Typed ${text.length} chars.` };
}

const KEY_MAP: Record<string, string> = {
  Enter: "{ENTER}", Escape: "{ESC}", Tab: "{TAB}", Backspace: "{BACKSPACE}", Delete: "{DELETE}",
  Left: "{LEFT}", Right: "{RIGHT}", Up: "{UP}", Down: "{DOWN}",
  Home: "{HOME}", End: "{END}", PageUp: "{PGUP}", PageDown: "{PGDN}", Space: " ",
  "Ctrl+C": "^c", "Ctrl+V": "^v", "Ctrl+X": "^x", "Ctrl+Z": "^z", "Ctrl+A": "^a", "Ctrl+S": "^s", "Ctrl+P": "^p",
  "Alt+Tab": "%{TAB}", "Alt+F4": "%{F4}",
  Win: "{LWIN}", "Win+D": "{LWIN}d", "Win+L": "{LWIN}l", "Win+E": "{LWIN}e",
  VolumeUp: "{VOLUMEUP}", VolumeDown: "{VOLUMEDOWN}", VolumeMute: "{VOLUMEMUTE}",
  MediaPlayPause: "{MEDIA_PLAY_PAUSE}", MediaNext: "{MEDIA_NEXT_TRACK}", MediaPrev: "{MEDIA_PREV_TRACK}",
};
for (let i = 1; i <= 12; i++) KEY_MAP[`F${i}`] = `{F${i}}`;

function keySend(args: Record<string, unknown>): ToolExecResult {
  const key = String(args.key ?? "").trim();
  const mapped = KEY_MAP[key];
  if (!mapped) return { result: `Error: key "${key}" is not in the allowed list.` };
  const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${psQuote(mapped)})`;
  const out = runPowershell(script, { timeoutMs: 15000 });
  if (out.startsWith("Error:")) return { result: `Error: key send failed: ${out.slice(0, 200)}` };
  return { result: `Sent ${key}.` };
}

const MOUSE_HELPER = `
if (-not ([System.Management.Automation.PSTypeName]'JvMouse').Type) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class JvMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint data, IntPtr extra);
}
'@
}
`.trim();

function mouseAction(args: Record<string, unknown>): ToolExecResult {
  const verb = String(args.verb ?? "");
  const x = Math.round(Number(args.x ?? 0));
  const y = Math.round(Number(args.y ?? 0));
  if (!["move", "click", "right_click", "double_click"].includes(verb)) return { result: `Error: unknown mouse verb "${verb}".` };
  let body = `[void][JvMouse]::SetCursorPos(${x}, ${y});`;
  if (verb === "click") body += `[JvMouse]::mouse_event(0x02,0,0,0,[IntPtr]::Zero); [JvMouse]::mouse_event(0x04,0,0,0,[IntPtr]::Zero);`;
  else if (verb === "right_click") body += `[JvMouse]::mouse_event(0x08,0,0,0,[IntPtr]::Zero); [JvMouse]::mouse_event(0x10,0,0,0,[IntPtr]::Zero);`;
  else if (verb === "double_click") { body += `for ($i=0;$i -lt 2;$i++){[JvMouse]::mouse_event(0x02,0,0,0,[IntPtr]::Zero); [JvMouse]::mouse_event(0x04,0,0,0,[IntPtr]::Zero);}`; }
  const script = `${MOUSE_HELPER}\n${body}\n'done'`;
  const out = runPowershell(script, { timeoutMs: 15000 });
  if (out.startsWith("Error:")) return { result: `Error: mouse ${verb} failed: ${out.slice(0, 200)}` };
  return { result: `Mouse ${verb} at (${x}, ${y}).` };
}

function clipboard(args: Record<string, unknown>): ToolExecResult {
  const verb = String(args.verb ?? "");
  if (verb === "get") {
    const out = runPowershell("Get-Clipboard", { timeoutMs: 10000 });
    return { result: (out || "(clipboard empty)").slice(0, 1000) };
  }
  if (verb === "set") {
    const text = String(args.text ?? "");
    const out = runPowershell(`Set-Clipboard -Value ${psQuote(text)}`, { timeoutMs: 10000 });
    if (out.startsWith("Error:")) return { result: `Error: clipboard set failed: ${out.slice(0, 200)}` };
    return { result: "Clipboard set." };
  }
  return { result: "Error: clipboard verb must be 'get' or 'set'." };
}

function volumeSet(args: Record<string, unknown>): ToolExecResult {
  const verb = String(args.verb ?? "");
  const send = (k: string) => runPowershell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${psQuote(k)})`, { timeoutMs: 10000 });
  if (verb === "mute") { send("{VOLUMEMUTE}"); return { result: "Toggled mute." }; }
  if (verb === "up") { send("{VOLUMEUP}"); return { result: "Volume up." }; }
  if (verb === "down") { send("{VOLUMEDOWN}"); return { result: "Volume down." }; }
  if (verb === "set") {
    const pct = Math.max(0, Math.min(100, Math.round(Number(args.percent ?? 50))));
    // Best-effort absolute set via CoreAudio P/Invoke; fall back honestly.
    const script = `
$code = @'
using System;
using System.Runtime.InteropServices;
public class JvVol {
  [Guid("87CE5498-68D6-44E5-9215-6F47F9294C02"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator { int _0(); int _1(); int _2(); int _3(); int _4(); int _5(); int _6(); [PreserveSig] int GetDefaultAudioEndpoint(int df, int rl, out IMMDevice d); }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, int cls, int p, out object o); }
  [Guid("5CDF2C82-841E-4546-9722-0CF7407829A2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioEndpointVolume { [PreserveSig] int SetMasterVolumeLevelScalar(float f, Guid ec); [PreserveSig] int GetMasterVolumeLevelScalar(out float f); }
  public static string Set(float pct) {
    try {
      var e = (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")));
      IMMDevice d; e.GetDefaultAudioEndpoint(0, 1, out d);
      var iid = new Guid("5CDF2C82-841E-4546-9722-0CF7407829A2"); object o; d.Activate(ref iid, 1, 0, out o);
      ((IAudioEndpointVolume)o).SetMasterVolumeLevelScalar(pct, Guid.Empty); return "set:" + pct;
    } catch (Exception ex) { return "Error:" + ex.Message; }
  }
}
'@
Add-Type -TypeDefinition $code -Language CSharp
[JvVol]::Set([single](${pct}/100))
`.trim();
    const out = runPowershell(script, { timeoutMs: 15000 });
    if (out.startsWith("set:")) return { result: `Volume set to ~${pct}%.` };
    // CoreAudio unavailable on this host — be honest.
    return { result: `Absolute volume set unavailable on this host (${out.slice(0, 120)}). Use mute/up/down.` };
  }
  return { result: "Error: volume_set verb must be mute/up/down/set." };
}

// ── Tier 3 implementations (register pending op → CONFIRM) ───────────────────

function fileDelete(args: Record<string, unknown>, session: JarvisSession): ToolExecResult {
  const v = validatePath(String(args.path ?? ""));
  if (!v.ok) return { result: `Error: ${v.error}` };
  const permanent = !!args.permanent;
  const label = `${permanent ? "PERMANENTLY DELETE" : "DELETE"} ${v.abs}`;
  const trashRoot = join(tmpdir(), "jarvis-trash");
  let script: string;
  if (permanent) {
    script = `Remove-Item -Path ${psQuote(v.abs)} -Recurse -Force`;
  } else {
    const stamp = `${Date.now()}`;
    const dest = join(trashRoot, stamp);
    // Backslashes are literal inside PowerShell single-quoted strings — no
    // doubling needed. psQuote escapes any single quotes in the path.
    script = `$d=${psQuote(dest)}; New-Item -ItemType Directory -Force -Path $d | Out-Null; Move-Item -Path ${psQuote(v.abs)} -Destination $d -Force`;
  }
  const { nonce } = registerPendingOp(session, "os", label, async () => runPowershell(script, { timeoutMs: 30000 }));
  return { result: `Awaiting user confirmation to ${permanent ? "permanently delete" : "soft-delete"} ${v.abs}. A CONFIRM button has been shown; nothing runs until they click it.`, approval: { nonce, kind: "os", label } };
}

function fileMove(args: Record<string, unknown>, session: JarvisSession): ToolExecResult {
  const sv = validatePath(String(args.source ?? ""));
  if (!sv.ok) return { result: `Error: source — ${sv.error}` };
  const dv = validatePath(String(args.destination ?? ""));
  if (!dv.ok) return { result: `Error: destination — ${dv.error}` };
  const label = `MOVE ${sv.abs} -> ${dv.abs}`;
  const script = `Move-Item -Path ${psQuote(sv.abs)} -Destination ${psQuote(dv.abs)} -Force`;
  const { nonce } = registerPendingOp(session, "os", label, async () => runPowershell(script, { timeoutMs: 30000 }));
  return { result: `Awaiting confirmation to move ${sv.abs} to ${dv.abs}.`, approval: { nonce, kind: "os", label } };
}

function processKill(args: Record<string, unknown>, session: JarvisSession): ToolExecResult {
  const raw = String(args.name ?? "").trim().replace(/\.exe$/i, "");
  if (!raw) return { result: "Error: process_kill requires a 'name'." };
  if (CRITICAL_PROCESSES.includes(raw.toLowerCase())) return { result: `Error: refusing to kill critical Windows process "${raw}".` };
  const label = `KILL PROCESS ${raw}`;
  const script = `Stop-Process -Name ${psQuote(raw)} -Force -ErrorAction Continue; Get-Process -Name ${psQuote(raw)} -ErrorAction SilentlyContinue | Measure-Object | ForEach-Object { if ($_.Count -gt 0) { 'Error: still running' } else { 'killed' } }`;
  const { nonce } = registerPendingOp(session, "os", label, async () => runPowershell(script, { timeoutMs: 20000 }));
  return { result: `Awaiting confirmation to kill process ${raw}.`, approval: { nonce, kind: "os", label } };
}

function powerAction(args: Record<string, unknown>, session: JarvisSession): ToolExecResult {
  const verb = String(args.verb ?? "");
  if (verb === "lock") {
    runPowershell("rundll32.exe user32.dll,LockWorkStation", { timeoutMs: 10000 });
    return { result: "Locked the workstation." };
  }
  const map: Record<string, string> = {
    sleep: "rundll32.exe powrprof.dll,SetSuspendState 0,1,0",
    shutdown: "Stop-Computer -Force",
    restart: "Restart-Computer -Force",
  };
  const cmd = map[verb];
  if (!cmd) return { result: `Error: power_action verb must be lock/sleep/shutdown/restart.` };
  const label = `${verb.toUpperCase()} the PC`.replace("SHUTDOWN", "SHUT DOWN");
  const { nonce } = registerPendingOp(session, "os", label, async () => { const o = runPowershell(cmd, { timeoutMs: 30000 }); return o || `${verb} initiated`; });
  return { result: `Awaiting confirmation to ${verb} the PC. A CONFIRM button has been shown.`, approval: { nonce, kind: "os", label } };
}

function systemSetting(args: Record<string, unknown>, session: JarvisSession): ToolExecResult {
  const setting = String(args.setting ?? "");
  const value = String(args.value ?? "").trim();
  if (setting === "dark_mode") {
    const on = value === "on" ? 0 : 1; // AppsUseLightTheme: 0 = dark, 1 = light
    const script = `Set-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name AppsUseLightTheme -Value ${on}; 'done'`;
    const out = runPowershell(script, { timeoutMs: 10000 });
    if (out.startsWith("Error:")) return { result: `Error: ${out.slice(0, 200)}` };
    return { result: `Dark mode ${value}.` };
  }
  if (setting === "brightness") {
    const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 50)));
    const script = `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ${pct}); 'done'`;
    const out = runPowershell(script, { timeoutMs: 15000 });
    if (out.startsWith("Error:")) return { result: `Error: brightness set failed (may need a battery-powered device): ${out.slice(0, 200)}` };
    return { result: `Brightness set to ${pct}%.` };
  }
  // Network toggles — gated (can disrupt connectivity). Best-effort via rfkill-ish
  // cmdlets; behavior varies by adapter. We register a CONFIRM and run the toggle.
  if (["wifi", "bluetooth", "airplane_mode"].includes(setting)) {
    const label = `${setting.replace("_", " ")} ${value}`;
    let script: string;
    if (setting === "wifi") {
      script = value === "on"
        ? `Enable-NetAdapter -Name '*' -Confirm:$false -ErrorAction SilentlyContinue; 'done'`
        : `Disable-NetAdapter -Name '*' -Confirm:$false -ErrorAction SilentlyContinue; 'done'`;
    } else if (setting === "bluetooth") {
      script = value === "on"
        ? `Get-PnpDevice -Class Bluetooth -Status Error,Degraded,Unknown -ErrorAction SilentlyContinue | Enable-PnpDevice -Confirm:$false; 'done'`
        : `Get-PnpDevice -Class Bluetooth -Status OK -ErrorAction SilentlyContinue | Disable-PnpDevice -Confirm:$false; 'done'`;
    } else {
      script = value === "on"
        ? `Set-NetAdapterAdvancedProperty -Name '*' -DisplayName 'Airplane Mode' -DisplayValue 1 -ErrorAction SilentlyContinue; 'done'`
        : `Set-NetAdapterAdvancedProperty -Name '*' -DisplayName 'Airplane Mode' -DisplayValue 0 -ErrorAction SilentlyContinue; 'done'`;
    }
    const { nonce } = registerPendingOp(session, "os", label, async () => runPowershell(script, { timeoutMs: 20000 }));
    return { result: `Awaiting confirmation to set ${setting} ${value}.`, approval: { nonce, kind: "os", label } };
  }
  return { result: `Error: unknown setting "${setting}".` };
}

// ── win_script — raw PowerShell escape hatch ───────────────────────────────
const SHELL_BLOCKLIST: RegExp[] = [
  /Format-Volume/i,
  /\bdiskpart\b/i,
  /\bbcdedit\b/i,
  /cipher\s+\/w/i,
  /\breg\s+delete\s+HKLM\\SYSTEM\b/i,
  /\breg\s+delete\s+HKLM\\SOFTWARE\\Microsoft\\Windows\b/i,
  /Remove-Item\s+[^\n]*C:\\Windows\b/i,
  /Remove-Item\s+[^\n]*C:\\Program Files\b/i,
  /Remove-Item\s+[^\n]*C:\\Program Files\s*\(x86\)/i,
  /\bdel\s+\/[^\n]*\/s\s+\/q\s+C:\\/i,
  /\bmklink\b[^\n]*C:\\Windows\b/i,
  /\btakeown\b[^\n]*C:\\Windows\b/i,
  /\bicacls\b[^\n]*C:\\Windows\b/i,
  /\btaskkill\b\s+\/[^\n]*\b(?:lsass|wininit|services|smss|csrss|svchost|winlogon)\b/i,
  /Get-ChildItem\s+[^\n]*C:\\Windows\b[^\n]*\|\s*Remove-Item/i,
  /Remove-Item\s+[^\n]*-Recurse\s+-Force\s+[^\n]*C:\\Users\\[^\n]*\\AppData\b/i,
  /\bStop-Computer\b[^\n]*-Force/i,
  /\bRestart-Computer\b[^\n]*-Force/i,
];

function winScript(args: Record<string, unknown>, session: JarvisSession): ToolExecResult {
  if (!session.allowRawShell) {
    return { result: `Raw shell access is not enabled. Ask the user to toggle "Allow raw shell" on, then retry.` };
  }
  const script = String(args.script ?? "");
  const desc = String(args.description ?? "unspecified").trim();
  if (!script.trim()) return { result: "Error: win_script requires a 'script' argument." };
  for (const re of SHELL_BLOCKLIST) {
    if (re.test(script)) return { result: `Error: Script matches a blocked pattern and is always refused: ${re.source}` };
  }
  const label = `RUN POWERSHELL: ${desc.slice(0, 80)}`;
  const { nonce } = registerPendingOp(session, "shell", label, async () => runPowershell(script, { timeoutMs: 30000 }));
  return {
    result:
      `Dry-run preview — this script will NOT run until you click CONFIRM.\n\n` +
      `--- SCRIPT ---\n${script}\n--- END SCRIPT ---\n\n` +
      `Description: ${desc}\n\nRead the script carefully. If correct, click CONFIRM to execute.`,
    approval: { nonce, kind: "shell", label },
  };
}