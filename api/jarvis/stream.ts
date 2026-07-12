// Jarvis SSE stream handler + in-memory sessions. Wires the pieces together:
// auth → load/create session → append user message → run the LLM tool-loop
// (llm.ts) → write SSE events to the client → synthesize per-sentence TTS.
//
// Two routes registered on the Hono app:
//   POST /api/jarvis/stream   — the realtime turn (POST + SSE response)
//   POST /api/jarvis/approve  — releases a pending service_control op after a click
//
// LOCAL-DEV ONLY: the tools it calls are box-local. See llm.ts / tools.ts.

import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { verifyBearer } from "../context";
import { env } from "../lib/env";
import { runTurn } from "./llm";
import { runApproved } from "./approvals";
import { executeOsTool } from "./os";
import { executeTool } from "./tools";
import { routeCommand } from "./router";
import { pendingForSession } from "./approvals";
import type { JarvisMessage, JarvisSession, SSEEvent } from "./types";

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 min idle → evicted
const sessions = new Map<string, JarvisSession>();

export function registerJarvisRoutes(app: Hono<any>) {
  // ── The realtime turn ────────────────────────────────────────────────────
  app.post("/api/jarvis/stream", async (c) => {
    const user = await verifyBearer(c.req.raw.headers.get("authorization"));
    if (!user) return c.json({ detail: "Unauthorized" }, 401);

    let body: { message?: string; sessionId?: string; voiceId?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ detail: "Invalid JSON body" }, 400);
    }
    const message = (body.message ?? "").trim();
    if (!message) return c.json({ detail: "Missing 'message'" }, 400);
    // Per-turn voice override from the UI voice-picker; empty = env default.
    const voiceOverride = (body.voiceId ?? "").trim() || null;

    const session = getOrCreateSession(body.sessionId, user.email);
    session.messages.push({ role: "user", content: message });
    session.lastActiveAt = Date.now();
    sweepStaleSessions();

    return streamSSE(c, async (stream) => {
      let assistantContent = "";
      let finalContent = ""; // last round's text — what we speak + persist as the final answer
      const ttsEnabled = !!(env.elevenLabsApiKey || env.openAiApiKey);
      // Stream neural TTS per sentence. Emitted BEFORE turn_end so the client's
      // audioPlayedRef is already true when onTurnEnd fires — it never falls back
      // to speechSynthesis on top of neural audio (no double voice).
      const emitAudio = async (text: string) => {
        if (!ttsEnabled || !text) return;
        for (const [i, sentence] of splitSentences(text).entries()) {
          const audio = await synthSpeech(sentence, voiceOverride).catch(() => null);
          if (audio) await stream.writeSSE({ event: "audio", data: JSON.stringify({ seq: i, mime: "audio/mpeg", base64: audio }) });
        }
      };
      const write = async (ev: SSEEvent) => {
        if (ev.event === "token") assistantContent += ev.data;
        if (ev.event === "turn_end") {
          // Speak the FINAL answer only (not the intermediate "let me capture…"
          // narration, which already streamed as tokens). Audio first, then turn_end.
          const content = (ev.data as { content?: string }).content ?? assistantContent;
          finalContent = content;
          await emitAudio(content);
          await stream.writeSSE({ event: "turn_end", data: JSON.stringify({ content }) });
          return;
        }
        await stream.writeSSE({ event: ev.event, data: typeof ev.data === "string" ? ev.data : JSON.stringify(ev.data) });
      };

      // ── Fast deterministic command router ("100x" path) ─────────────────────
      // Common direct commands (screenshot, status, open <app>, type X, volume,
      // lock, dark mode, …) are handled WITHOUT an LLM round — the router returns
      // the exact tool calls, we run them through executeTool (same gates/CONFIRM
      // as the LLM path), speak a canned line, and end the turn in ~2–3s. The
      // LLM path below handles everything complex/ambiguous/passthrough.
      const route = routeCommand(message, session);
      if (route.kind === "direct") {
        try {
          for (const call of route.calls) {
            await write({ event: "tool_call", data: { name: call.name, args: call.args } });
            await write({ event: "ping", data: { t: Date.now() } });
            const { result, approval, events } = await executeTool(call.name, call.args, session);
            await write({ event: "tool_result", data: { name: call.name, result: result.slice(0, 500) } });
            if (events?.length) for (const ev of events) await write(ev);
            const approvals = approval ? [approval, ...pendingForSession(session.id).filter((p) => p.nonce !== approval.nonce)] : pendingForSession(session.id);
            if (approvals.length) await write({ event: "approvals", data: approvals });
            // Persist the routed call + result so later LLM turns have context.
            const id = `call_${randomUUID()}`;
            session.messages.push({
              role: "assistant",
              tool_calls: [{ id, type: "function", function: { name: call.name, arguments: call.args as unknown as string } }],
            });
            session.messages.push({ role: "tool", tool_call_id: id, content: result });
          }
          // Speak the canned line + end the turn. If a CONFIRM is pending, the
          // canned line already says so; the user confirms via /approve later.
          const spoken = route.canned;
          await write({ event: "token", data: spoken });
          await write({ event: "turn_end", data: { content: spoken } });
        } catch (e: any) {
          await write({ event: "error", data: { message: `Fast path failed: ${e?.message ?? String(e)}` } });
        }
      } else {
        // ── Situational awareness ("Eyes on") ───────────────────────────────
        // Before the model thinks, capture the screen (OCR) + system status and
        // inject them as EPHEMERAL context — appended to the system prompt for
        // THIS turn only (ensureSystem rewrites the system message fresh every
        // turn, so nothing stale persists). The screenshot image is also streamed
        // to the client so the user sees what Jarvis sees. Read-only → no gate.
        // (Skipped on the fast path above — the routed calls capture what's needed.)
        let liveCtx = "";
        if (session.situational) {
          try {
            const sc = await executeOsTool("screen_capture", {}, session);
            const ss = await executeOsTool("sys_status", {}, session);
            if (sc.events?.length) for (const ev of sc.events) await write(ev);
            const ocr = (sc.result ?? "").slice(0, 1800);
            const status = (ss.result ?? "").slice(0, 300);
            liveCtx =
              "\n[LIVE CONTEXT — current screen + system state, this turn only]\n" +
              `Screen OCR:\n${ocr || "(blank / unreadable)"}\n` +
              `System: ${status}`;
          } catch {
            // perception is best-effort; never block a turn on it
            liveCtx = "";
          }
        }

        try {
          for await (const ev of runTurn(session.messages, session, liveCtx)) {
            await write(ev);
          }
        } catch (e: any) {
          await write({ event: "error", data: { message: `Turn failed: ${e?.message ?? String(e)}` } });
        }
      }

      // Persist the FINAL assistant answer so it carries into the next user message.
      // Intermediate tool-calling rounds already pushed their own assistant messages
      // inside runTurn, so we persist only the last round here — no duplication.
      if (finalContent) {
        session.messages.push({ role: "assistant", content: finalContent });
      }
      session.lastActiveAt = Date.now();
    });
  });

  // ── Approve a pending op (service_control start/stop, OS destructive op,
  //    or win_script raw shell) — all flow through the generic registry. ──────
  app.post("/api/jarvis/approve", async (c) => {
    const user = await verifyBearer(c.req.raw.headers.get("authorization"));
    if (!user) return c.json({ detail: "Unauthorized" }, 401);
    let body: { nonce?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ detail: "Invalid JSON body" }, 400);
    }
    if (!body.nonce) return c.json({ detail: "Missing 'nonce'" }, 400);
    const res = await runApproved(body.nonce);
    return c.json(res, res.ok ? 200 : 400);
  });

  // ── Session introspection for the tRPC router (jarvis-router.ts) ─────────
  // Exposed as a plain export, not a route.
}

/** Public accessor so jarvis-router.ts can read sessions without a route. */
export function listSessionsForUser(email: string) {
  sweepStaleSessions();
  return [...sessions.values()]
    .filter((s) => s.userId === email)
    .map((s) => ({ id: s.id, createdAt: s.createdAt, lastActiveAt: s.lastActiveAt, messageCount: s.messages.length }));
}
export function getSession(id: string, email: string): JarvisSession | null {
  const s = sessions.get(id);
  if (!s || s.userId !== email) return null;
  return s;
}
export function getMessages(id: string, email: string): JarvisMessage[] | null {
  const s = getSession(id, email);
  return s ? s.messages : null;
}
export function setAllowShell(id: string, email: string, allow: boolean): boolean {
  const s = getSession(id, email);
  if (!s) return false;
  s.allowShell = allow;
  return true;
}
export function setAllowOsControl(id: string, email: string, allow: boolean): boolean {
  const s = getSession(id, email);
  if (!s) return false;
  s.allowOsControl = allow;
  return true;
}
export function setAllowRawShell(id: string, email: string, allow: boolean): boolean {
  const s = getSession(id, email);
  if (!s) return false;
  s.allowRawShell = allow;
  return true;
}
export function setSituational(id: string, email: string, allow: boolean): boolean {
  const s = getSession(id, email);
  if (!s) return false;
  s.situational = allow;
  return true;
}

// ── helpers ─────────────────────────────────────────────────────────────────
function getOrCreateSession(id: string | undefined, email: string): JarvisSession {
  if (id && sessions.has(id)) {
    const s = sessions.get(id)!;
    if (s.userId === email) return s;
  }
  const newId = id && !sessions.has(id) ? id : randomUUID();
  const s: JarvisSession = { id: newId, userId: email, messages: [], allowShell: false, allowOsControl: false, allowRawShell: false, situational: false, createdAt: Date.now(), lastActiveAt: Date.now() };
  sessions.set(newId, s);
  return s;
}

function sweepStaleSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActiveAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

function splitSentences(text: string): string[] {
  // Split on . ! ? (keeping the punctuation), drop empties, trim.
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Synthesize one sentence to base64 mp3. Prefers ElevenLabs (richer voices,
// low-latency turbo model — the user's chosen provider) when its key is set,
// then OpenAI tts-1. Returns null on any failure so the caller just skips that
// sentence and the client falls back to speechSynthesis on the text it has.
async function synthSpeech(input: string, voiceOverride: string | null = null): Promise<string | null> {
  if (!input.trim()) return null;
  const voiceId = voiceOverride || env.elevenLabsVoiceId;
  if (env.elevenLabsApiKey && voiceId) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": env.elevenLabsApiKey, Accept: "audio/mpeg" },
        body: JSON.stringify({
          text: input,
          model_id: env.elevenLabsModel,
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
        }),
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        return buf.toString("base64");
      }
      // fall through to OpenAI on ElevenLabs error
    } catch {
      // fall through
    }
  }
  if (env.openAiApiKey) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.openAiApiKey}` },
      body: JSON.stringify({ model: "tts-1", voice: "alloy", input, response_format: "mp3" }),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  }
  return null;
}