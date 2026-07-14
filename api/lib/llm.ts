// Non-streaming, structured-output LLM completion helper. Distinct from
// api/jarvis/llm.ts (which is streaming + tool-call-shaped + Jarvis-coupled);
// this one is for the documents module's metadata-extraction step, which needs
// a single complete JSON-shaped response, not a token stream.
//
// Provider selection mirrors Jarvis (env.jarvisProvider: kimi > openrouter >
// ollama) and reuses the SAME env getters, so no new env key is introduced.
// Kimi's mandatory "User-Agent: KimiCLI/1.0" header (gotcha #9) is set here too.
// Returns the raw text content of the model's single response — the caller
// parses + zod-validates (LLMs wrap JSON in prose; we strip code fences).

import { env } from "./env";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompleteOpts {
  messages: ChatMessage[];
  /** Request response_format json_object where the provider supports it. */
  json?: boolean;
  /** Override env.jarvisProvider (kimi | openrouter | ollama). */
  provider?: string;
  /** Override env.jarvisModel (or env.jarvisOllamaModel for ollama). */
  model?: string;
  /** Sampling temperature. Defaults low (0.2) — extraction wants determinism. */
  temperature?: number;
}

/**
 * Run one non-streaming chat completion and return the assistant's text content.
 * Throws on HTTP failure (the caller decides how to degrade — documents.ingest
 * stores raw text with null metadata if the LLM is unavailable).
 */
export async function chatComplete(opts: ChatCompleteOpts): Promise<string> {
  const provider = opts.provider ?? env.jarvisProvider;
  const temperature = opts.temperature ?? 0.2;

  if (provider === "ollama") {
    return ollamaComplete(opts.messages, opts.model ?? env.jarvisOllamaModel, temperature, opts.json);
  }
  if (provider === "kimi") {
    return openAICompatibleComplete({
      url: `${env.kimiBaseUrl}/chat/completions`,
      key: env.kimiApiKey,
      model: opts.model ?? env.jarvisModel,
      extraHeaders: { "User-Agent": "KimiCLI/1.0" },
      messages: opts.messages,
      json: opts.json,
      temperature,
      label: "Kimi",
    });
  }
  // default cloud path: openrouter
  return openAICompatibleComplete({
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: env.openRouterApiKey,
    model: opts.model ?? env.jarvisModel,
    extraHeaders: { "X-Title": "SAHIIXX OS Documents" },
    messages: opts.messages,
    json: opts.json,
    temperature,
    label: "OpenRouter",
  });
}

interface OpenAICompleteOpts {
  url: string;
  key: string | undefined;
  model: string;
  extraHeaders?: Record<string, string>;
  messages: ChatMessage[];
  json?: boolean;
  temperature: number;
  label: string;
}

async function openAICompatibleComplete(o: OpenAICompleteOpts): Promise<string> {
  if (!o.key) {
    throw new Error(`${o.label} key is not set (provider=${env.jarvisProvider}).`);
  }
  const body: Record<string, unknown> = {
    model: o.model,
    messages: o.messages,
    stream: false,
    temperature: o.temperature,
  };
  if (o.json) body.response_format = { type: "json_object" };
  const res = await fetch(o.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${o.key}`,
      ...o.extraHeaders,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${o.label} HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const content: string | undefined = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`${o.label} returned an empty completion.`);
  }
  return content;
}

async function ollamaComplete(messages: ChatMessage[], model: string, temperature: number, json?: boolean): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Ollama Cloud (https://ollama.com) requires a Bearer key; local Ollama
  // (localhost:11434) does not. The header is attached only when a key is set,
  // so the same code path serves both local and cloud — switching is just an
  // env change (OLLAMA_URL + OLLAMA_API_KEY + a cloud model tag).
  if (env.ollamaApiKey) headers.Authorization = `Bearer ${env.ollamaApiKey}`;
  // Ollama's native JSON mode forces a single valid JSON object as the response
  // content. Critical for reasoning models (glm-5.2, kimi-k2-turbo, ...) that
  // otherwise intermittently emit prose or route everything to `thinking`.
  const body: Record<string, unknown> = { model, messages, stream: false, options: { temperature } };
  if (json) body.format = "json";
  const res = await fetch(`${env.ollamaUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama HTTP ${res.status} at ${env.ollamaUrl}: ${detail.slice(0, 300)}`);
  }
  const jsonResp: any = await res.json();
  // Reasoning models (glm-5.2, kimi-k2-turbo, deepseek-r1, ...) intermittently
  // return an EMPTY `content` with the answer (including the JSON) routed to
  // `thinking`. Prefer `content`; fall back to `thinking` so extraction still
  // succeeds. extractJson() finds the JSON object whichever field holds it.
  const content: string | undefined = jsonResp?.message?.content;
  const thinking: string | undefined = jsonResp?.message?.thinking;
  const out = (typeof content === "string" && content.trim()) ? content
    : (typeof thinking === "string" && thinking.trim()) ? thinking
    : undefined;
  if (!out) {
    throw new Error("Ollama returned an empty completion (content and thinking both empty).");
  }
  return out;
}

/**
 * Best-effort extraction of a JSON object from an LLM text response. Models
 * frequently wrap JSON in prose or code fences even when asked for JSON. We
 * find the first balanced `{...}` span and parse it; if that fails, try a
 * fenced ```json ... ``` block. Returns null if nothing parses.
 */
export function extractJson(content: string): Record<string, unknown> | null {
  const s = content.trim();
  // 1) fenced code block
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : s;
  // 2) first balanced {...} span
  const start = candidate.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = candidate.slice(start, i + 1);
        try {
          const obj = JSON.parse(slice);
          return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}