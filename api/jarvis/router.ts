// Fast deterministic command router — the "100x" path for common direct
// commands. Pattern-matches high-confidence user intents and returns the exact
// tool calls to run, so Jarvis responds in ~2–3s WITHOUT an LLM round (the
// llama3.2:3b model takes 25–105s and sometimes double-calls). The LLM path in
// llm.ts still handles everything complex/ambiguous.
//
// Safety is unchanged: routed calls go through executeTool(), so tier-2 tools
// still require allowOsControl, tier-3 tools still require a CONFIRM click,
// and read-only tools still run ungated. This router only DECIDES which tool
// to call and what canned line to speak — it never bypasses a gate.
//
// Returns passthrough when the message isn't a confident match, when it looks
// like a question ("how do I…", "what is…"), or when it mentions multiple
// actions (let the LLM sequence them).

import type { JarvisSession } from "./types";

export interface RoutedCall {
  name: string;
  args: Record<string, unknown>;
}
export type RouteResult =
  | { kind: "passthrough" }
  | { kind: "direct"; calls: RoutedCall[]; canned: string };

const APP_ALLOWLIST = [
  "notepad", "calculator", "calc", "paint", "mspaint",
  "edge", "chrome", "brave", "firefox", "browser",
  "word", "winword", "excel", "powerpoint",
  "explorer", "file explorer", "task manager", "taskmanager",
  "terminal", "cmd", "command prompt", "powershell",
  "settings", "spotify", "vscode", "code", "snipping tool",
];

const KEY_ALLOWLIST = new Set([
  "enter", "return", "escape", "esc", "tab", "backspace", "delete",
  "left", "right", "up", "down", "home", "end", "pageup", "pagedown",
  "space", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
  "ctrl+c", "ctrl+v", "ctrl+x", "ctrl+z", "ctrl+a", "ctrl+s", "ctrl+p",
  "alt+tab", "alt+f4", "win", "win+d", "win+l", "win+e",
  "volumeup", "volumedown", "volumemute", "mediaplaypause", "medianext", "mediaprev",
]);

// Messages that should always go to the LLM (questions, explanations, multi-step).
const LOOKS_LIKE_LLM =
  /\b(how (do|to|can)|why|explain|tell me about|what (is|are) the|summar|research|find (me |out )?|search|generate|build|write (me )? (a |an )?(script|email|report|message|note)|delegate|dispatch to opa|nexus|deals?|contacts?|start|stop|restart)\b/i;

/** Main entry. Pure (no I/O). */
export function routeCommand(message: string, _session: JarvisSession): RouteResult {
  const raw = message.trim();
  if (!raw) return { kind: "passthrough" };
  const m = raw.toLowerCase();

  // Never route questions / multi-step / OPA / NEXUS / service-control — those
  // are the LLM's job (it sequences + narrates them).
  if (LOOKS_LIKE_LLM.test(m)) return { kind: "passthrough" };

  // ── Read-only perception ────────────────────────────────────────────────
  if (/\b(what('?s| is)|whats) on (my |the )?screen\b|read (me )?the screen\b|look at (my |the )?screen\b|see (my |the )?screen\b/.test(m))
    return { kind: "direct", calls: [{ name: "screen_capture", args: {} }], canned: "Looking at the screen now." };
  if (/\b(take a |grab a |capture a |run |do )?(screenshot|screen ?shot|screen_capture)\b|capture (the )?screen\b|screen capture\b/.test(m))
    return { kind: "direct", calls: [{ name: "screen_capture", args: {} }], canned: "Screenshot captured." };
  if (/\b(system status|sys_status|what('?s| is) (the )?status|how('?s| is) (the )?(system|computer|machine|pc) (running|doing|health)|check (the )?system|how much (ram|memory|disk))\b/.test(m))
    return { kind: "direct", calls: [{ name: "sys_status", args: {} }], canned: "Here's the system status." };
  if (/\b(what('?s| is) running|list (the )?processes|show (the )?processes|running apps|what processes)\b/.test(m))
    return { kind: "direct", calls: [{ name: "process_list", args: {} }], canned: "Here are the top processes." };
  if (/\b(list (the )?open windows|show (the )?windows|what windows)\b/.test(m))
    return { kind: "direct", calls: [{ name: "window_list", args: {} }], canned: "Here are the open windows." };

  // ── Immediate (non-gated) actions ───────────────────────────────────────
  if (/\block (the )?(screen|computer|pc|machine)?\b/.test(m))
    return { kind: "direct", calls: [{ name: "power_action", args: { verb: "lock" } }], canned: "Locking the screen." };
  if (/\bdark mode (on|enable)\b|\bturn on dark mode\b|\benable dark mode\b/.test(m))
    return { kind: "direct", calls: [{ name: "system_setting", args: { setting: "dark_mode", value: "on" } }], canned: "Switching to dark mode." };
  if (/\bdark mode (off|disable)\b|\bturn off dark mode\b|\bdisable dark mode\b|\blight mode\b/.test(m))
    return { kind: "direct", calls: [{ name: "system_setting", args: { setting: "dark_mode", value: "off" } }], canned: "Switching to light mode." };

  // ── Gated Tier-2 actions (allowOsControl + CONFIRM enforced downstream) ─
  // NOTE: capturing patterns match against the ORIGINAL `raw` (with the /i flag)
  // so user-meaningful strings keep their case — paths, app names, and text to
  // type must not be lowercased.
  let mm = raw.match(/\bopen (?<app>[a-z][a-z0-9 .+_-]{1,40})\b/i);
  if (mm) {
    const app = mm.groups!.app.trim();
    const appLower = app.toLowerCase();
    if (APP_ALLOWLIST.includes(appLower) || /\.(exe)$/i.test(app)) {
      return { kind: "direct", calls: [{ name: "app_open", args: { name: cap(app) } }], canned: `Opening ${app}. Tap CONFIRM to proceed.` };
    }
    // Unrecognized app name — let the LLM disambiguate.
    return { kind: "passthrough" };
  }
  // app_close (by title) — title is case-sensitive downstream
  mm = raw.match(/\bclose (?<title>.+)\b/i);
  if (mm) {
    const title = mm.groups!.title.trim();
    if (title.length >= 2) return { kind: "direct", calls: [{ name: "app_close", args: { title } }], canned: `Closing "${title}". Tap CONFIRM to proceed.` };
  }
  // type_text — quoted or unquoted trailing text (case preserved)
  mm = raw.match(/\btype (?<text>"(?<q>[^"]+)"|'(?<sq>[^']+)'|(?<bare>.+))$/i);
  if (mm) {
    const text = (mm.groups!.q ?? mm.groups!.sq ?? mm.groups!.bare ?? "").trim();
    if (text) return { kind: "direct", calls: [{ name: "type_text", args: { text } }], canned: `Typing "${text}". Tap CONFIRM to proceed.` };
  }
  // key_send
  mm = raw.match(/\b(press|hit|send) (the )?(?<key>[a-z0-9+]+)\b/i);
  if (mm) {
    const key = normalizeKey(mm.groups!.key);
    if (key && KEY_ALLOWLIST.has(key))
      return { kind: "direct", calls: [{ name: "key_send", args: { key } }], canned: `Pressing ${key}. Tap CONFIRM to proceed.` };
  }
  // volume_set
  mm = raw.match(/\bvolume (?<verb>up|down|mute|mute the|raise|lower)\b/i);
  if (mm) {
    const v = mm.groups!.verb.toLowerCase();
    const verb = v === "raise" ? "up" : v === "lower" ? "down" : v === "mute the" ? "mute" : v;
    return { kind: "direct", calls: [{ name: "volume_set", args: { verb } }], canned: `Turning volume ${verb}. Tap CONFIRM to proceed.` };
  }

  // ── Read-only file ops (paths keep original case) ───────────────────────
  mm = raw.match(/\b(list files (in|under|at) (?<dir>.+)|show files (in|under|at) (?<dir2>.+))$/i);
  if (mm) {
    const dir = (mm.groups!.dir ?? mm.groups!.dir2 ?? "").trim();
    if (dir) return { kind: "direct", calls: [{ name: "file_list", args: { path: dir } }], canned: `Listing files in ${dir}.` };
  }
  mm = raw.match(/\b(read (me )?(the )?(file )?(?<file>.+))$/i);
  if (mm) {
    const file = mm.groups!.file.trim();
    if (file && file.split(/\s+/).length <= 4) return { kind: "direct", calls: [{ name: "file_read", args: { path: file } }], canned: `Reading ${file}.` };
  }

  return { kind: "passthrough" };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function normalizeKey(k: string): string {
  const s = k.toLowerCase().replace(/\s+/g, "");
  return s;
}