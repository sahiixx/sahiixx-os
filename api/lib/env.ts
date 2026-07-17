// Env access that works in both Cloudflare Workers (binding via globalThis)
// and plain Node/Vite dev (process.env). boot.ts injects Cloudflare env into
// globalThis per request; here we just read whichever is populated.

const DEV_AUTH_SECRET = "sahiixx-dev-secret-change-me"; // fallback so `npm run dev` works out of the box; prod MUST set AUTH_SECRET
const DEV_ADMIN_EMAIL = "admin@sahiixx.os";
const DEV_ADMIN_PASSWORD = "sahiixx";

/** Strip BOM / zero-width / surrounding whitespace from secret/env strings.
 *  PowerShell `Set-Content -Encoding UTF8` and some secret-put paths inject
 *  U+FEFF, which breaks `new URL()` / fetch ("Invalid URL: \uFEFFhttps://…"). */
export function cleanEnv(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v)
    .replace(/^\uFEFF+/, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .trim();
  return s.length ? s : undefined;
}

function g(key: string): string | undefined {
  return cleanEnv((globalThis as any)[key]) ?? cleanEnv(process.env[key]);
}

let authSecretWarned = false;

export const env = {
  get databaseUrl() {
    return g("__DATABASE_URL") ?? process.env.DATABASE_URL ?? "";
  },
  get authSecret() {
    const s = g("AUTH_SECRET");
    if (!s) {
      if (!authSecretWarned) {
        authSecretWarned = true;
        console.warn("[env] AUTH_SECRET not set — using dev fallback. Do NOT use in production.");
      }
      return DEV_AUTH_SECRET;
    }
    return s;
  },
  get adminEmail() {
    return g("ADMIN_EMAIL") ?? DEV_ADMIN_EMAIL;
  },
  get adminPassword() {
    return g("ADMIN_PASSWORD") ?? DEV_ADMIN_PASSWORD;
  },
  // ── Jarvis (realtime voice agent) ───────────────────────────────────────
  // All optional. With zero keys, Jarvis falls back to local Ollama for the
  // LLM and the browser's speechSynthesis for TTS — everything still works,
  // just lower quality + unreliable tool-calling on sub-7B local models.
  get openRouterApiKey() {
    return g("OPENROUTER_API_KEY") ?? process.env.OPENROUTER_API_KEY;
  },
  get kimiApiKey() {
    // "sk-kimi-…" keys from the Kimi Coding platform (platform.kimi.ai / kimi.com/code).
    // These are NOT valid against api.moonshot.ai/v1 (returns 401) — they must be
    // used against the kimi base URL below, with a "User-Agent: KimiCLI/1.0" header
    // (otherwise 403: "only available for Coding Agents such as Kimi CLI, Claude
    // Code, Roo Code, Kilo Code"). OpenAI-compatible chat/completions protocol.
    return g("KIMI_API_KEY") ?? process.env.KIMI_API_KEY;
  },
  get kimiBaseUrl() {
    return g("KIMI_BASE_URL") ?? process.env.KIMI_BASE_URL ?? "https://api.kimi.com/coding/v1";
  },
  get openAiApiKey() {
    return g("OPENAI_API_KEY") ?? process.env.OPENAI_API_KEY;
  },
  get anthropicApiKey() {
    return g("ANTHROPIC_API_KEY") ?? process.env.ANTHROPIC_API_KEY;
  },
  get retellApiKey() {
    return g("RETELL_API_KEY") ?? process.env.RETELL_API_KEY;
  },
  get ollamaUrl() {
    return g("OLLAMA_URL") ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
  },
  // Ollama Cloud API key (https://ollama.com/settings/keys). When set, the
  // Ollama completion path sends it as `Authorization: Bearer <key>` and you
  // should point OLLAMA_URL at the cloud base `https://ollama.com`. Local
  // Ollama (localhost:11434) needs NO key and is unaffected. Cloud models use
  // the base tag without the `-cloud` suffix (e.g. gpt-oss:120b, qwen3.5,
  // kimi-k2.6, deepseek-v4-flash). Catalog: https://ollama.com/search?c=cloud
  get ollamaApiKey() {
    return g("OLLAMA_API_KEY") ?? process.env.OLLAMA_API_KEY;
  },
  // ── ElevenLabs (neural TTS for Jarvis voice) ──────────────────────────────
  // Optional. When set, synthSpeech in api/jarvis/stream.ts prefers ElevenLabs
  // over OpenAI tts-1 (richer voices, lower latency with the turbo model). With
  // no key, falls back to OpenAI if OPENAI_API_KEY is set, else the client uses
  // browser speechSynthesis on the text it already received.
  get elevenLabsApiKey() {
    return g("ELEVENLABS_API_KEY") ?? process.env.ELEVENLABS_API_KEY;
  },
  get elevenLabsVoiceId() {
    // "Rachel" — a clean default narrator. Override with any voice id from your
    // ElevenLabs library / the voice the user used in flow WCS4cjuHieXRjbpEy61l.
    return g("ELEVENLABS_VOICE_ID") ?? process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
  },
  get elevenLabsModel() {
    // eleven_turbo_v2_5 = lowest latency for realtime; eleven_multilingual_v2 = best quality.
    return g("ELEVENLABS_MODEL") ?? process.env.ELEVENLABS_MODEL ?? "eleven_turbo_v2_5";
  },
  // ── Postiz (self-hostable social scheduler — SARA content factory backend) ──
  // Optional. When both POSTIZ_API_URL and POSTIZ_API_KEY are set, SARA can list
  // connected social channels and create/schedule real posts through Postiz.
  // With neither set, SARA stays in local-tracking mode (campaigns/videos dashboards).
  get postizApiUrl() {
    // Postiz Public API base: cloud = https://api.postiz.com/public/v1, self-hosted = <backend>/public/v1
    return g("POSTIZ_API_URL") ?? process.env.POSTIZ_API_URL ?? "";
  },
  get postizApiKey() {
    return g("POSTIZ_API_KEY") ?? process.env.POSTIZ_API_KEY;
  },
  /** Provider: explicit JARVIS_PROVIDER wins; else auto-pick kimi > openrouter > ollama. */
  get jarvisProvider() {
    const explicit = g("JARVIS_PROVIDER") ?? process.env.JARVIS_PROVIDER;
    if (explicit) return explicit;
    return this.kimiApiKey ? "kimi" : this.openRouterApiKey ? "openrouter" : "ollama";
  },
  get jarvisModel() {
    // Model id for the active provider. Default is OpenAI-compatible; set
    // JARVIS_MODEL explicitly for other providers (e.g. kimi-k2.6 for Kimi).
    return g("JARVIS_MODEL") ?? process.env.JARVIS_MODEL ?? "openai/gpt-4o-mini";
  },
  get jarvisOllamaModel() {
    // Local Ollama model tag. Default to llama3.2:3b — the only tool-capable model
    // pulled on this box (declares capabilities:["completion","tools"]). The smaller
    // models (qwen2.5:0.5b / llama3.2:1b / phi3:mini) tool-call unreliably and are NOT
    // pulled on the Windows Ollama anyway. For a real upgrade, set OPENROUTER_API_KEY.
    return g("JARVIS_OLLAMA_MODEL") ?? process.env.JARVIS_OLLAMA_MODEL ?? "llama3.2:3b";
  },
  get opaDispatchUrl() {
    return g("OPA_DISPATCH_URL") ?? process.env.OPA_DISPATCH_URL ?? "http://localhost:8082/dispatch";
  },
  get opaApiKey() {
    return g("OPA_API_KEY") ?? process.env.OPA_API_KEY;
  },
  // ── Live NEXUS / sahiix-estate (WSL app, optional public base URL) ──────────
  // Local Vite default hits WSL-bound :3001. On Cloudflare Pages set
  // ESTATE_API_URL to a tunnel / public host that reaches the estate API.
  get estateApiUrl() {
    const explicit = g("ESTATE_API_URL") ?? process.env.ESTATE_API_URL;
    if (explicit) return explicit;
    // Local Vite only — never default localhost on Cloudflare Pages/Workers.
    const onPages = !!(g("CF_PAGES") || process.env.CF_PAGES);
    const isProd = process.env.NODE_ENV === "production" || onPages;
    if (!isProd) return "http://127.0.0.1:3001";
    return "";
  },
  get estateApiKey() {
    return g("ESTATE_API_KEY") ?? process.env.ESTATE_API_KEY;
  },
};

// Setters for Cloudflare Workers env injection (called from boot.ts middleware).
export function setDatabaseUrl(url: string) {
  (globalThis as any).__DATABASE_URL = url;
}

/** Hyperdrive TCP connection string (Workers). Never clobbers DATABASE_URL. */
export function setHyperdriveUrl(url: string) {
  (globalThis as any).__HYPERDRIVE_URL = url;
}

export function clearHyperdriveUrl() {
  delete (globalThis as any).__HYPERDRIVE_URL;
}
export function setAuthSecret(s: string) {
  (globalThis as any).AUTH_SECRET = s;
}
export function setAdminCreds(email: string, password: string) {
  (globalThis as any).ADMIN_EMAIL = email;
  (globalThis as any).ADMIN_PASSWORD = password;
}
// Jarvis env setters — only needed for the Cloudflare deploy path (Vite dev
// reads these from .env via process.env automatically). Mirror the pattern above.
export function setOpenRouterApiKey(k: string) { (globalThis as any).OPENROUTER_API_KEY = k; }
export function setKimiApiKey(k: string) { (globalThis as any).KIMI_API_KEY = k; }
export function setKimiBaseUrl(u: string) { (globalThis as any).KIMI_BASE_URL = u; }
export function setOpenAiApiKey(k: string) { (globalThis as any).OPENAI_API_KEY = k; }
export function setAnthropicApiKey(k: string) { (globalThis as any).ANTHROPIC_API_KEY = k; }
export function setRetellApiKey(k: string) { (globalThis as any).RETELL_API_KEY = k; }
export function setOllamaUrl(u: string) { (globalThis as any).OLLAMA_URL = cleanEnv(u) ?? ""; }
export function setOllamaApiKey(k: string) { (globalThis as any).OLLAMA_API_KEY = cleanEnv(k) ?? ""; }
export function setElevenLabsApiKey(k: string) { (globalThis as any).ELEVENLABS_API_KEY = k; }
export function setElevenLabsVoiceId(v: string) { (globalThis as any).ELEVENLABS_VOICE_ID = v; }
export function setElevenLabsModel(m: string) { (globalThis as any).ELEVENLABS_MODEL = m; }
export function setPostizApiUrl(u: string) { (globalThis as any).POSTIZ_API_URL = u; }
export function setPostizApiKey(k: string) { (globalThis as any).POSTIZ_API_KEY = k; }
export function setJarvisProvider(p: string) { (globalThis as any).JARVIS_PROVIDER = p; }
export function setJarvisModel(m: string) { (globalThis as any).JARVIS_MODEL = m; }
export function setJarvisOllamaModel(m: string) { (globalThis as any).JARVIS_OLLAMA_MODEL = m; }
export function setOpaDispatchUrl(u: string) { (globalThis as any).OPA_DISPATCH_URL = u; }
export function setOpaApiKey(k: string) { (globalThis as any).OPA_API_KEY = k; }
export function setEstateApiUrl(u: string) { (globalThis as any).ESTATE_API_URL = cleanEnv(u) ?? ""; }
export function setEstateApiKey(k: string) { (globalThis as any).ESTATE_API_KEY = cleanEnv(k) ?? ""; }