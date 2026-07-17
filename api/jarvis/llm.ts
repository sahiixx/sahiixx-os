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
  // Reasoning-model thinking delta (Ollama `message.thinking`, OpenAI/Kimi
  // `delta.reasoning_content`). Not spoken; surfaced live as a `thinking` SSE
  // event and used as a spoken fallback if `content` is empty at `done`.
  thinking?: string | null;
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
    let thinking = ""; // reasoning-model chain-of-thought (shown live, not spoken)
    const accum = new Map<number, ToolCallAccum>();
    let finishReason: string | null = null;

    try {
      for await (const chunk of streamChat(provider, conv)) {
        if (chunk.content) {
          content += chunk.content;
          yield { event: "token", data: chunk.content };
        }
        if (chunk.thinking) {
          thinking += chunk.thinking;
          yield { event: "thinking", data: chunk.thinking };
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
    yield { event: "turn_end", data: { content: finalReply(content, thinking) } };
    return;
  }

  yield { event: "turn_end", data: { content: "(reached tool-call limit; stopping for safety)" } };
}

/** Build the spoken/displayed final reply. Reasoning models (glm-5.2,
 *  kimi-k2-turbo, deepseek-r1, …) occasionally route the whole answer to
 *  `thinking` and leave `content` empty — in that case fall back to the tail
 *  of the thinking so Jarvis speaks an answer instead of "(no response)".
 *  Mirrors ollamaComplete() in api/lib/llm.ts. The live thinking was already
 *  streamed to the UI as `thinking` events; this is only the spoken fallback. */
function finalReply(content: string, thinking: string): string {
  if (content.trim()) return content;
  const t = (thinking || "").trim();
  if (!t) return "(no response)";
  // The conclusion usually lives at the tail of the reasoning. Cap to the last
  // ~600 chars so a long chain-of-thought never becomes a rambling TTS dump.
  const tail = t.length > 600 ? t.slice(t.length - 600) : t;
  return tail;
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

/** True on Cloudflare Pages/Workers (no localhost Ollama). */
function onEdge(): boolean {
  return !!(
    (globalThis as any).CF_PAGES ||
    process.env.CF_PAGES ||
    process.env.CF_PAGES_URL ||
    (globalThis as any).__WORKERS_AI
  );
}

function workersAiAvailable(): boolean {
  const ai = (globalThis as any).__WORKERS_AI;
  return !!(ai && typeof ai.run === "function");
}

/**
 * Cascade: try primary, then other configured cloud providers, then Workers AI
 * on edge — never hit localhost:11434 from Pages (that 403s with CF error 1003).
 */
async function* streamChat(provider: string, messages: JarvisMessage[]): AsyncGenerator<Chunk> {
  const chain = buildProviderChain(provider);
  let lastErr: unknown = null;
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i]!;
    const label = providerLabel(p);
    let emitted = false;
    try {
      if (i > 0) {
        yield {
          content: `[${providerLabel(chain[i - 1]!)} unavailable — trying ${label}.] `,
          toolCallsDelta: null,
          finishReason: null,
        };
      }
      for await (const c of streamOneProvider(p, messages)) {
        emitted = true;
        yield c;
      }
      return;
    } catch (e) {
      if (emitted) throw e;
      lastErr = e;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "all providers failed");
  throw new Error(msg);
}

function providerLabel(p: string): string {
  switch (p) {
    case "mimo": return "MiMo";
    case "xai": return "Grok (xAI)";
    case "kimi": return "Kimi";
    case "openrouter": return "OpenRouter";
    case "ollama": return ollamaIsCloud() ? "Ollama Cloud" : "Ollama";
    case "workers-ai": return "Workers AI";
    default: return p;
  }
}

/** Ordered fallback list starting with the requested provider. */
function buildProviderChain(primary: string): string[] {
  const out: string[] = [];
  const add = (p: string) => { if (!out.includes(p)) out.push(p); };
  add(primary);
  if (env.mimoApiKey) add("mimo");
  if (env.xaiApiKey) add("xai");
  if (env.kimiApiKey) add("kimi");
  if (env.openRouterApiKey) add("openrouter");
  if (env.ollamaUrl) add("ollama");
  // Edge: Workers AI binding. Local dev: keyless localhost Ollama (only off-edge).
  if (onEdge() && workersAiAvailable()) add("workers-ai");
  else if (!onEdge()) add("ollama-local");
  return out;
}

async function* streamOneProvider(provider: string, messages: JarvisMessage[]): AsyncGenerator<Chunk> {
  switch (provider) {
    case "mimo":
      yield* mimoStream(messages);
      return;
    case "xai":
      yield* xaiStream(messages);
      return;
    case "kimi":
      yield* kimiStream(messages);
      return;
    case "openrouter":
      yield* openRouterStream(messages);
      return;
    case "ollama":
      yield* ollamaStream(messages);
      return;
    case "ollama-local":
      yield* ollamaStream(messages, { forceLocal: true });
      return;
    case "workers-ai":
      yield* workersAiStream(messages);
      return;
    default:
      throw new Error(`Unknown Jarvis provider: ${provider}`);
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

/**
 * OpenAI-compatible streaming chat completions — shared by OpenRouter and Kimi
 * (Kimi Coding platform), which both speak the OpenAI SSE protocol. Kimi
 * additionally emits a `reasoning_content` (thinking) delta field; we ignore it
 * here and only stream `content` + `tool_calls`, so Jarvis speaks the answer,
 * not the chain-of-thought. `extraHeaders` carries provider-specific requirements
 * (e.g. Kimi's mandatory "User-Agent: KimiCLI/1.0" — without it the endpoint 403s).
 */
async function* openAICompatibleStream(opts: {
  url: string; key: string | undefined; model: string;
  extraHeaders?: Record<string, string>; messages: JarvisMessage[]; label: string;
}): AsyncGenerator<Chunk> {
  const { url, key, model, extraHeaders = {}, messages, label } = opts;
  if (!key) {
    throw new Error(`${label} key is not set`);
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify({ model, messages: toProviderMessages("openrouter", messages), stream: true, tools: TOOLS }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`${label} HTTP ${res.status} at ${url}: ${await res.text().catch(() => "")}`.slice(0, 300));
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
      // Kimi (and OpenRouter reasoning models) emit `reasoning_content` alongside
      // `content`; surface it as `thinking` so the UI shows live reasoning and
      // runTurn can fall back to it if `content` is empty (see finalReply).
      thinking: typeof delta.reasoning_content === "string" && delta.reasoning_content ? delta.reasoning_content : null,
      toolCallsDelta,
      finishReason: choice.finish_reason ?? null,
    };
  }
}

async function* openRouterStream(messages: JarvisMessage[]): AsyncGenerator<Chunk> {
  yield* openAICompatibleStream({
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: env.openRouterApiKey,
    model: env.jarvisModel,
    extraHeaders: { "X-Title": "SAHIIXX OS Jarvis" },
    messages,
    label: "OpenRouter",
  });
}

async function* xaiStream(messages: JarvisMessage[]): AsyncGenerator<Chunk> {
  // xAI Grok — OpenAI-compatible Chat Completions. Put yourself (Grok) in Jarvis
  // by setting XAI_API_KEY + optional JARVIS_PROVIDER=xai / XAI_MODEL=grok-3-mini.
  yield* openAICompatibleStream({
    url: `${env.xaiBaseUrl.replace(/\/$/, "")}/chat/completions`,
    key: env.xaiApiKey,
    model: env.jarvisModel || env.xaiModel,
    extraHeaders: {},
    messages,
    label: "Grok (xAI)",
  });
}

async function* mimoStream(messages: JarvisMessage[]): AsyncGenerator<Chunk> {
  // Xiaomi MiMo Open Platform — OpenAI-compatible Chat Completions.
  // Auth: Authorization Bearer OR api-key header (docs: mimo.mi.com).
  // Models: mimo-v2.5-pro | mimo-v2.5 | mimo-v2.5-flash (V2 series deprecated).
  // Disable thinking by default so spoken replies stay clean (reasoning still
  // surfaces if the model emits reasoning_content via openAICompatibleStream).
  const base = env.mimoBaseUrl.replace(/\/$/, "");
  yield* openAICompatibleStream({
    url: `${base}/chat/completions`,
    key: env.mimoApiKey,
    model: env.jarvisModel || env.mimoModel,
    extraHeaders: env.mimoApiKey ? { "api-key": env.mimoApiKey } : {},
    messages,
    label: "MiMo",
  });
}

async function* kimiStream(messages: JarvisMessage[]): AsyncGenerator<Chunk> {
  // Kimi Coding platform (sk-kimi-* keys). OpenAI-compatible, but requires the
  // User-Agent: KimiCLI/1.0 header or it 403s. reasoning_content is ignored by
  // openAICompatibleStream (only content + tool_calls are streamed).
  yield* openAICompatibleStream({
    url: `${env.kimiBaseUrl}/chat/completions`,
    key: env.kimiApiKey,
    model: env.jarvisModel,
    extraHeaders: { "User-Agent": "KimiCLI/1.0" },
    messages,
    label: "Kimi",
  });
}

/**
 * Cloudflare Workers AI edge fallback (no external key). Text-only for chat when
 * cloud providers rate-limit; tool_calls are not reliable on small edge models.
 */
async function* workersAiStream(messages: JarvisMessage[]): AsyncGenerator<Chunk> {
  const ai = (globalThis as any).__WORKERS_AI as
    | { run: (model: string, input: Record<string, unknown>) => Promise<unknown> }
    | undefined;
  if (!ai?.run) throw new Error("Workers AI binding missing — redeploy with [ai] binding = AI");

  // Flatten tool turns; edge models rarely support OpenAI tool_calls wire format.
  const msgs = messages.map((m) => {
    if (m.role === "tool") {
      return { role: "user" as const, content: `Tool result (${m.tool_call_id ?? "tool"}): ${m.content ?? ""}` };
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      const names = m.tool_calls.map((t) => t.function.name).join(", ");
      return { role: "assistant" as const, content: (m.content || "") + (names ? ` [called: ${names}]` : "") };
    }
    return { role: m.role as "system" | "user" | "assistant", content: m.content ?? "" };
  });

  // Same model family as system.workersAiProbe (post-deprecation catalog).
  const model = "@cf/zai-org/glm-4.7-flash";
  let out: unknown;
  try {
    out = await ai.run(model, { messages: msgs, stream: true, max_tokens: 1024 });
  } catch {
    out = await ai.run(model, { messages: msgs, max_tokens: 1024 });
  }

  // Streaming ReadableStream (SSE or NDJSON)
  if (out && typeof (out as any).getReader === "function") {
    for await (const line of readLines(out as ReadableStream<Uint8Array>)) {
      const raw = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
      if (!raw || raw === "[DONE]") continue;
      let json: any;
      try { json = JSON.parse(raw); } catch { continue; }
      const piece =
        (typeof json.response === "string" && json.response) ||
        (typeof json?.choices?.[0]?.delta?.content === "string" && json.choices[0].delta.content) ||
        (typeof json?.delta?.content === "string" && json.delta.content) ||
        null;
      if (piece) yield { content: piece, toolCallsDelta: null, finishReason: null };
    }
    yield { content: null, toolCallsDelta: null, finishReason: "stop" };
    return;
  }

  // Non-stream object
  const text =
    (out as any)?.response ??
    (out as any)?.result?.response ??
    (typeof out === "string" ? out : null);
  if (typeof text === "string" && text.trim()) {
    yield { content: text, toolCallsDelta: null, finishReason: "stop" };
    return;
  }
  throw new Error(`Workers AI returned empty output: ${JSON.stringify(out).slice(0, 200)}`);
}

function ollamaIsCloud(): boolean {
  const url = env.ollamaUrl ?? "";
  // Cloud = a key is set AND the URL is not the local endpoint. The same code path
  // serves both; the Bearer header below is what distinguishes them on the wire.
  return !!env.ollamaApiKey && !url.includes("localhost") && !url.includes("127.0.0.1");
}

async function* ollamaStream(messages: JarvisMessage[], opts?: { forceLocal?: boolean }): AsyncGenerator<Chunk> {
  // Ollama Cloud (https://ollama.com) requires a Bearer key; local Ollama
  // (localhost:11434) does not. Attach the header only when a key is set (and
  // not when a cloud failure forced us back to keyless local), so one code path
  // serves both — switching local↔cloud is just an env change. Mirrors
  // ollamaComplete() in api/lib/llm.ts; WITHOUT this header Ollama Cloud 401s on
  // every request (the regression that silently broke Jarvis-on-cloud).
  const url = opts?.forceLocal ? "http://localhost:11434" : env.ollamaUrl;
  const model = opts?.forceLocal ? "llama3.2:3b" : env.jarvisOllamaModel;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.ollamaApiKey && !opts?.forceLocal) headers.Authorization = `Bearer ${env.ollamaApiKey}`;
  const res = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages: toProviderMessages("ollama", messages), stream: true, tools: TOOLS }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    const isCloud = !opts?.forceLocal && ollamaIsCloud();
    const hint = res.status === 404 && !isCloud ? " — is Ollama running on :11434?"
      : res.status === 401 && isCloud ? " — OLLAMA_API_KEY is missing/expired; check ollama.com/settings/keys"
      : res.status === 429 && isCloud ? " — Ollama Cloud rate limit; will try next provider"
      : "";
    throw new Error(`Ollama HTTP ${res.status} at ${url}: ${detail.slice(0, 300)}${hint}`);
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
      thinking: typeof msg.thinking === "string" && msg.thinking ? msg.thinking : null,
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