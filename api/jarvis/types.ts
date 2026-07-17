// Shared types for the Jarvis realtime voice-agent module.
// Kept in one place so tools.ts / os.ts / approvals.ts / llm.ts / stream.ts can
// import without cycles.

/** A single chat message in the OpenAI-compatible roles format. */
export interface JarvisMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  // OpenAI tool-call shape (present on assistant messages that requested a tool).
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  // Present on role:"tool" messages (the tool result).
  tool_call_id?: string;
}

/** An in-memory conversation session (v1: no DB persistence). */
export interface JarvisSession {
  id: string;
  userId: string;
  messages: JarvisMessage[];
  allowShell: boolean; // service_control start/stop (existing)
  allowOsControl: boolean; // tier-2 + tier-3 OS-control tools
  allowRawShell: boolean; // win_script raw-PowerShell escape hatch
  situational: boolean; // "Eyes on": capture screen + sys_status as ephemeral context before each turn
  createdAt: number;
  lastActiveAt: number;
}

/** Which tool family a pending confirmation belongs to (drives UI + speech). */
export type PendingKind = "service" | "os" | "shell";

/** SSE event shape emitted by the stream handler. */
export type SSEEvent =
  | { event: "token"; data: string }
  // Reasoning-model "thinking" delta (Ollama `message.thinking`, OpenAI/Kimi
  // `delta.reasoning_content`). Streamed live so the UI can show Jarvis is
  // reasoning (not frozen) during the silent pre-answer phase reasoning models
  // spend in `thinking` before emitting `content`. NOT spoken — only `token`
  // goes to TTS. When a reasoning model leaves `content` empty at `done`,
  // runTurn falls back to the tail of the accumulated thinking as the spoken
  // answer (mirrors ollamaComplete in api/lib/llm.ts).
  | { event: "thinking"; data: string }
  | { event: "tool_call"; data: { name: string; args: Record<string, unknown> } }
  | { event: "tool_result"; data: { name: string; result: string } }
  | { event: "audio"; data: { seq: number; mime: string; base64: string } }
  | { event: "screen"; data: { seq: number; mime: string; base64: string; width: number; height: number } }
  | { event: "approvals"; data: Array<{ nonce: string; kind: PendingKind; label: string }> }
  | { event: "turn_end"; data: { content: string } }
  | { event: "ping"; data: { t: number } }
  | { event: "error"; data: { message: string } };

/** Result of executing a tool. Every executor returns this so a tool failure is a
 *  clean string the LLM narrates, never a thrown crash of the SSE stream. */
export interface ToolExecResult {
  result: string;
  /** Present when a mutating op needs a client confirmation click before it runs. */
  approval?: { nonce: string; kind: PendingKind; label: string };
  /** Extra SSE events to emit right after the tool_result (e.g. screen_capture's image). */
  events?: SSEEvent[];
}

/** The OpenAI-format tool schema sent to the LLM. */
export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON schema
  };
}