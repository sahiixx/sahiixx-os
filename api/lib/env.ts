// Env access that works in both Cloudflare Workers (binding via globalThis)
// and plain Node/Vite dev (process.env). boot.ts injects Cloudflare env into
// globalThis per request; here we just read whichever is populated.

const DEV_AUTH_SECRET = "sahiixx-dev-secret-change-me"; // fallback so `npm run dev` works out of the box; prod MUST set AUTH_SECRET
const DEV_ADMIN_EMAIL = "admin@sahiixx.os";
const DEV_ADMIN_PASSWORD = "sahiixx";

function g(key: string): string | undefined {
  return (globalThis as any)[key] ?? process.env[key];
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
  /** "openrouter" if an OpenRouter key is present, else "ollama". */
  get jarvisProvider() {
    const explicit = g("JARVIS_PROVIDER") ?? process.env.JARVIS_PROVIDER;
    if (explicit) return explicit;
    return this.openRouterApiKey ? "openrouter" : "ollama";
  },
  get jarvisModel() {
    // OpenRouter model id (default OpenAI-compatible cheap/fast tool-caller).
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
};

// Setters for Cloudflare Workers env injection (called from boot.ts middleware).
export function setDatabaseUrl(url: string) {
  (globalThis as any).__DATABASE_URL = url;
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
export function setOpenAiApiKey(k: string) { (globalThis as any).OPENAI_API_KEY = k; }
export function setAnthropicApiKey(k: string) { (globalThis as any).ANTHROPIC_API_KEY = k; }
export function setRetellApiKey(k: string) { (globalThis as any).RETELL_API_KEY = k; }
export function setOllamaUrl(u: string) { (globalThis as any).OLLAMA_URL = u; }
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