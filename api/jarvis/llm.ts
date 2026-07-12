// The streaming LLM turn-loop with tool-calling. This is the brain of Jarvis:
// it streams chat-completion tokens to the client as they arrive, and when the
// model emits tool_calls it executes them (via tools.ts), feeds the results
// back into the conversation, and re-prompts — streaming the whole time.
//
// Two providers, picked by env.jarvisProvider (auto = OpenRouter if a key is
// present, else local Ollama):
//   • OpenRouter — OpenAI-compatible /chat/completions, SSE response.
//     tool_calls arrive as FRAGMENTED string deltas (must buffer per index, parse
//     the arguments string only at finish_reason:"tool_calls"). #1 bug magnet.
//   • Ollama     — /api/chat, NDJSON response. tool_calls arrive COMPLETE in one
//     chunk, and `arguments` is a JSON OBJECT (not a string!) — both in the
//     response and required in the request. This differs from OpenAI and is easy
//     to get wrong; we normalize to a canonical object internally and adapt per
//     provider when sending (see toProviderMessages).
//
// LOCAL-DEV ONLY on the Ollama path (localhost:11434). OpenRouter works anywhere
// with egress. Tool execution (tools.ts) is local-only regardless.

import { env } from "../lib/env";
import { TOOLS, executeTool } from "./tools";
import { pendingForSession } from "./approvals";
import type { JarvisMessage, JarvisSession, SSEEvent } from "./types";

const SYSTEM_PROMPT =
  "You are JARVIS, the user's real-time AI operations assistant for the SAHIIX OS stack. " +
  "You are concise, direct, and ACT. Rule #1: when the user asks for anything actionable, you MUST call a tool — do not say \"I will...\" and then stop. Saying you will do something without calling the tool is a failure. " +
  "You have tools: opa_dispatch (delegate any task to the One Person Agency router — research, scraping, codegen, signal collection, workflow runs), " +
  "nexus_query (read-only deals/contacts), and service_control (status/start/stop the SAHIIX WSL services). " +
  "You also have Windows OS-control tools: screen_capture (screenshot + OCR so you can SEE the screen — call this FIRST for anything visual), sys_status, window_list, process_list, file_list, file_read, app_open, app_close, type_text, key_send, mouse_action, clipboard, window_focus, volume_set, file_delete, file_move, process_kill, power_action, system_setting. " +
  "When you call a tool, ALWAYS include ALL required arguments as a JSON object. " +
  "Speak replies aloud (they become speech), so keep turns short and spoken — no markdown, no lists longer than 4 items, no code blocks unless asked. " +
  "If a tool returns 'Error: ...', tell the user briefly what failed and offer a next step; do not repeat the whole error. " +
  "OS-control tools require the user to enable 'Allow OS control'. Destructive ops (file_delete, file_move, process_kill, sleep/shutdown/restart, network toggles) require an additional CONFIRM click — say plainly what you're about to do and that a CONFIRM button will appear, and that nothing runs until they confirm. " +
  "win_script is a raw-PowerShell escape hatch: provide 'script' and 'description'. It requires 'Allow raw shell' plus a CONFIRM click, and the user sees the exact script before confirming. Always prefer the most specific bounded tool over win_script. " +
  "If the user references something on screen you haven't seen this turn, call screen_capture before acting.";

const MAX_TOOL_ROUNDS = 6; // cap so a chatty model can't loop forever

/** Known tool names, for rescuing tool-calls the small local model emits as
 *  raw JSON text instead of a structured tool_call (its most common failure). */
const TOOL_NAMES = new Set(TOOLS.map((t) => t.function.name));

/** One normalized chunk from either provider's stream. */
interface Chunk {
  content: string | null;
  toolCallsDelta: Array<{ index: number; id?: string; name?: string; argsStr?: string; argsObj?: Record<string, unknown> }> | null;
  finishReason: string | null;
}

/** Accumulated tool call across deltas. argsObj wins (Ollama sends it whole). */
interface ToolCallAccum {
  id: string;
  name: string;
  argsStr: string;
  argsObj: Record<string, unknown> | null;
}

/** The main turn generator. Streams SSEEvents; the caller writes them to the client.
 *  `liveCtx` is an OPTIONAL ephemeral string (situational-awareness OCR + status)
 *  appended to the system prompt for THIS turn only — never persisted (ensureSystem
 *  rewrites the system message fresh each turn). */
export async function* runTurn(messages: JarvisMessage[], session: JarvisSession, liveCtx = ""): AsyncGenerator<SSEEvent> {
  const conv = ensureSystem(messages, session, liveCtx);
  const provider = env.jarvisProvider;
  let fellBack = false; // one-shot intent fallback guard (no infinite loop)

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let content = "";
    const accum = new Map<number, ToolCallAccum>();
    let finishReason: string | null = null;

    try {
      for await (const chunk of streamChat(provider, conv)) {
        if (chunk.content) {
          content += chunk.content;
          yield { event: "token", data: chunk.content };
        }
        if (chunk.toolCallsDelta) {
          for (const d of chunk.toolCallsDelta) {
            const slot = accum.get(d.index) ?? { id: d.id ?? "", name: d.name ?? "", argsStr: "", argsObj: null };
            if (d.id) slot.id = d.id;
            if (d.name) slot.name = d.name;
            if (typeof d.argsStr === "string") slot.argsStr += d.argsStr; // OpenRouter delta
            if (d.argsObj && typeof d.argsObj === "object") slot.argsObj = d.argsObj; // Ollama whole
            accum.set(d.index, slot);
          }
        }
        if (chunk.finishReason) finishReason = chunk.finishReason;
      }
    } catch (e: any) {
      yield { event: "error", data: { message: `LLM stream failed: ${e?.message ?? String(e)}` } };
      return;
    }

    const calls = [...accum.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);

    if (calls.length > 0 || finishReason === "tool_calls") {
      if (!calls.length) {
        yield { event: "turn_end", data: { content: content || "(no response)" } };
        return;
      }
      // Resolve final args (object) per call. Ollama: argsObj. OpenRouter: parse argsStr.
      const resolved = calls.map((c) => ({
        id: c.id || `call_${Math.random().toString(36).slice(2)}`,
        name: c.name,
        args: (c.argsObj ?? safeParseArgs(c.argsStr)) as Record<string, unknown>,
      }));

      // Append the assistant message that requested the tools. Canonical form:
      // arguments stored as an OBJECT (each provider adapts it when sending).
      conv.push({
        role: "assistant",
        content: content || undefined,
        tool_calls: resolved.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args as unknown as string } })),
      });

      for (const c of resolved) {
        yield { event: "tool_call", data: { name: c.name, args: c.args } };
        yield { event: "ping", data: { t: Date.now() } }; // hold the stream + signal "working"
        const { result, approval, events } = await executeTool(c.name, c.args, session);
        yield { event: "tool_result", data: { name: c.name, result: result.slice(0, 500) } };
        // Some tools emit sideband events alongside their text result (e.g.
        // screen_capture pushes the screenshot image). Emit those right after.
        if (events && events.length) {
          for (const ev of events) yield ev;
        }
        const approvals = approval ? [approval, ...pendingForSession(session.id).filter((p) => p.nonce !== approval.nonce)] : pendingForSession(session.id);
        if (approvals.length) yield { event: "approvals", data: approvals };
        conv.push({ role: "tool", tool_call_id: c.id, content: result });
      }
      continue; // re-prompt with the tool results
    }

    // No tool calls this round. The local 3B model often *describes* an action
    // ("I'll take a screenshot now") instead of emitting a tool_call. Catch that
    // ONCE: synthesize the read-only tool it described, or nudge it to call the
    // mutating tool it described. All real gates/CONFIRM still apply downstream.
    if (!fellBack) {
      const fb = intentFallback(content, session);
      if (fb) {
        fellBack = true;
        if (fb.kind === "call") {
          const c = fb.call;
          conv.push({
            role: "assistant",
            content: content || undefined,
            tool_calls: [{ id: c.id, type: "function", function: { name: c.name, arguments: c.args as unknown as string } }],
          });
          yield { event: "tool_call", data: { name: c.name, args: c.args } };
          yield { event: "ping", data: { t: Date.now() } };
          const { result, approval, events } = await executeTool(c.name, c.args, session);
          yield { event: "tool_result", data: { name: c.name, result: result.slice(0, 500) } };
          if (events?.length) for (const ev of events) yield ev;
          const approvals = approval ? [approval, ...pendingForSession(session.id).filter((p) => p.nonce !== approval.nonce)] : pendingForSession(session.id);
          if (approvals.length) yield { event: "approvals", data: approvals };
          conv.push({ role: "tool", tool_call_id: c.id, content: result });
          continue; // re-prompt so the model can narrate the result
        }
        // nudge: re-prompt with a system instruction to actually call a tool
        conv.push({ role: "assistant", content: content || undefined });
        // nudge as a `user` message: mid-conversation `system` messages are rejected
        // by some OpenAI-compatible providers, and a user-role nudge won't pollute
        // future turns the way a stray system message does.
        conv.push({ role: "user", content: "You described an action but did not call a tool. Call the appropriate tool now with full arguments, or if the task is genuinely conversational, give the final short spoken answer." });
        continue;
      }
    }

    // No tool calls — turn is done.
    yield { event: "turn_end", data: { content: content || "(no response)" } };
    return;
  }

  yield { event: "turn_end", data: { content: "(reached tool-call limit; stopping for safety)" } };
}

/** Parse a tool call the model emitted as raw JSON text. Accepts the common
 *  shapes — {name, parameters}, {name, arguments}, {name, args} — and only
 *  returns a call when `name` is a real tool. Conservative: requires the ENTIRE
 *  content to be a single JSON object, so a sentence that merely contains JSON
 *  is left alone (handled by the prose regexes below if applicable). */
function parseTextToolCall(content: string): { name: string; args: Record<string, unknown> } | null {
  const s = content.trim();
  if (!s.startsWith("{") || !s.endsWith("}")) return null;
  let obj: any;
  try { obj = JSON.parse(s); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  const name = typeof obj.name === "string" ? obj.name : null;
  if (!name || !TOOL_NAMES.has(name)) return null;
  const args = obj.parameters ?? obj.arguments ?? obj.args ?? {};
  return { name, args: args && typeof args === "object" ? (args as Record<string, unknown>) : {} };
}

/**
 * Conservative one-shot intent fallback for the unreliable 3B local model.
 * Fires only when the model produced TEXT (no tool_calls) that *describes* an
 * action it should have called a tool for. Safety: only READ-ONLY tools are
 * ever synthesized here; mutating actions get a nudge to re-call (so the real
 * allowOsControl gate + per-op CONFIRM still apply). Returns null if the text
 * is a normal conversational answer.
 */
export function intentFallback(
  content: string,
  session: JarvisSession,
): null | { kind: "call"; call: { id: string; name: string; args: Record<string, unknown> } } | { kind: "nudge" } {
  const t = (content || "").toLowerCase();
  if (!t) return null;
  const newId = () => `call_${Math.random().toString(36).slice(2)}`;

  // The local 3B model often emits a tool call as RAW JSON TEXT instead of a
  // structured tool_call — e.g. `{"name":"system_status","parameters":{}}` or
  // `{"name":"file_read","arguments":{"path":"…"}}`. If the whole content is
  // exactly such a JSON object naming a real tool, synthesize the call. The
  // downstream gates still apply (allowOsControl, validatePath, per-op CONFIRM),
  // so this is safe even for mutating/destructive tools — we're honoring the
  // model's explicit structured call, not guessing from prose.
  const jsonCall = parseTextToolCall(content);
  if (jsonCall) return { kind: "call", call: { id: newId(), name: jsonCall.name, args: jsonCall.args } };

  // Read-only perception: synthesize the call directly. These are always safe.
  if (/\b(screenshot|screen ?shot|capture the screen|what'?s on (my )?screen|what'?s on screen|read the screen)\b/.test(t))
    return { kind: "call", call: { id: newId(), name: "screen_capture", args: {} } };
  if (/\b(system status|how (is|are) (the )?(system|computer|machine) (running|doing)|what'?s (the )?status|how much (ram|memory|disk))\b/.test(t))
    return { kind: "call", call: { id: newId(), name: "sys_status", args: {} } };
  if (/\b(what'?s running|list (the )?processes|what processes|running apps|list windows|open windows)\b/.test(t))
    return { kind: "call", call: { id: newId(), name: "process_list", args: {} } };

  // Mutating actions the model *described* but didn't call: nudge it to call
  // (do NOT auto-run — the gate + CONFIRM must still apply). Only nudge when
  // OS control is enabled, else the model can't do anything useful anyway.
  if (!session.allowOsControl) return null;
  if (/\b(i('?ll| will)|let me|i am going to|going to)\b.*\b(open (notepad|calculator|edge|chrome|browser|paint|explorer|word|excel|terminal|cmd|powershell)|type|press|click|move (the )?mouse|delete|move (the )?file|kill (the )?process|sleep|restart|shut ?down|set (the )?volume)\b/.test(t))
    return { kind: "nudge" };

  return null;
}

function ensureSystem(messages: JarvisMessage[], session: JarvisSession, liveCtx = ""): JarvisMessage[] {
  const prompt = SYSTEM_PROMPT + recentActionsRecap(messages, session) + liveCtx;
  if (messages.length && messages[0].role === "system") {
    messages[0].content = prompt;
    return messages;
  }
  messages.unshift({ role: "system", content: prompt });
  return messages;
}

/** Compact recap of the last few tool calls + outcomes, so the 3B model can
 *  chain ("now type hello", "do it again") without re-reading long tool dumps. */
function recentActionsRecap(messages: JarvisMessage[], session: JarvisSession): string {
  const caps: string[] = [];
  for (let i = messages.length - 1; i >= 0 && caps.length < 3; i--) {
    const m = messages[i];
    if (m.role === "tool" && m.content) caps.unshift(`  - ${m.content.split("\n")[0].slice(0, 120)}`);
  }
  const flags = [
    session.allowShell && "serviceControl",
    session.allowOsControl && "osControl",
    session.allowRawShell && "rawShell",
    session.situational && "eyesOn",
  ].filter(Boolean).join(", ");
  return (
    `\n[Session flags: ${flags || "none enabled"}]` +
    (caps.length ? `\n[Recent actions — the user may reference these ("now type X", "do it again"):\n${caps.join("\n")}]` : "")
  );
}

function safeParseArgs(args: string): Record<string, unknown> {
  if (!args) return {};
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return { _raw: args };
  }
}

// ── Provider streaming ───────────────────────────────────────────────────────

async function* streamChat(provider: string, messages: JarvisMessage[]): AsyncGenerator<Chunk> {
  if (provider === "openrouter") {
    yield* openRouterStream(messages);
  } else {
    yield* ollamaStream(messages);
  }
}

/** Adapt canonical JarvisMessages to the provider's wire format. */
function toProviderMessages(provider: string, messages: JarvisMessage[]): unknown[] {
  return messages.map((m) => {
    if (provider === "ollama") {
      // Ollama: assistant tool_calls use NO id/type, arguments as OBJECT.
      // tool messages: {role:"tool", content} (strip tool_call_id).
      if (m.role === "assistant" && m.tool_calls) {
        return {
          role: "assistant",
          content: m.content ?? "",
          tool_calls: m.tool_calls.map((tc) => ({ function: { name: tc.function.name, arguments: tc.function.arguments as unknown as Record<string, unknown> } })),
        };
      }
      if (m.role === "tool") {
        return { role: "tool", content: m.content ?? "" };
      }
      return { role: m.role, content: m.content ?? "" };
    }
    // OpenRouter (OpenAI): arguments must be a STRING.
    if (m.role === "assistant" && m.tool_calls) {
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.tool_calls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.function.name, arguments: JSON.stringify(tc.function.arguments as unknown as Record<string, unknown>) } })),
      };
    }
    return m;
  });
}

async function* openRouterStream(messages: JarvisMessage[]): AsyncGenerator<Chunk> {
  const key = env.openRouterApiKey;
  if (!key) {
    yield { content: "OpenRouter key is not set and no local fallback is configured.", toolCallsDelta: null, finishReason: "stop" };
    return;
  }
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-Title": "SAHIIXX OS Jarvis" },
    body: JSON.stringify({ model: env.jarvisModel, messages: toProviderMessages("openrouter", messages), stream: true, tools: TOOLS }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`OpenRouter HTTP ${res.status}: ${await res.text().catch(() => "")}`.slice(0, 300));
  }
  for await (const line of readLines(res.body)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") return;
    let json: any;
    try { json = JSON.parse(payload); } catch { continue; }
    const choice = json.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};
    const toolCallsDelta = Array.isArray(delta.tool_calls) && delta.tool_calls.length
      ? delta.tool_calls.map((t: any) => ({ index: t.index ?? 0, id: t.id, name: t.function?.name, argsStr: t.function?.arguments }))
      : null;
    yield {
      content: typeof delta.content === "string" && delta.content ? delta.content : null,
      toolCallsDelta,
      finishReason: choice.finish_reason ?? null,
    };
  }
}

async function* ollamaStream(messages: JarvisMessage[]): AsyncGenerator<Chunk> {
  const res = await fetch(`${env.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.jarvisOllamaModel, messages: toProviderMessages("ollama", messages), stream: true, tools: TOOLS }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama HTTP ${res.status} at ${env.ollamaUrl}: ${detail.slice(0, 300)}` + (res.status === 404 ? " — is Ollama running on :11434?" : ""));
  }
  for await (const line of readLines(res.body)) {
    if (!line.trim()) continue;
    let json: any;
    try { json = JSON.parse(line); } catch { continue; }
    const msg = json.message ?? {};
    // Ollama returns tool_calls whole (arguments as an OBJECT). Normalize to the delta shape.
    const toolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length
      ? msg.tool_calls.map((t: any, i: number) => ({
          index: t.function?.index ?? i,
          id: t.id,
          name: t.function?.name,
          argsObj: (t.function?.arguments && typeof t.function.arguments === "object") ? t.function.arguments : null,
          argsStr: (typeof t.function?.arguments === "string") ? t.function.arguments : undefined,
        }))
      : null;
    yield {
      content: typeof msg.content === "string" && msg.content ? msg.content : null,
      toolCallsDelta: toolCalls,
      finishReason: json.done ? (toolCalls ? "tool_calls" : "stop") : null,
    };
    if (json.done) return;
  }
}

/** Yields complete lines from a ReadableStream<Uint8Array>, buffering partial lines. */
async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line.length) yield line;
      }
    }
    const tail = decoder.decode();
    buf += tail;
    if (buf.trim()) yield buf;
  } finally {
    reader.releaseLock();
  }
}