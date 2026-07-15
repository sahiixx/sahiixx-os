import { Hono } from "hono";
import { cors } from "hono/cors";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import superjson from "superjson";
import { sahiixxRouter } from "./sahiixx-router";
import { authRouter, } from "./auth-router";
import { jarvisRouter } from "./jarvis-router";
import { documentsRouter } from "./documents-router";
import { registerJarvisRoutes } from "./jarvis/stream";
import { router, verifyBearer, type AuthContext } from "./context";
import {
  setDatabaseUrl, setHyperdriveUrl, setAuthSecret, setAdminCreds,
  setOpenRouterApiKey, setOpenAiApiKey, setAnthropicApiKey, setRetellApiKey,
  setKimiApiKey, setKimiBaseUrl,
  setOllamaUrl, setOllamaApiKey, setJarvisProvider, setJarvisModel, setJarvisOllamaModel,
  setOpaDispatchUrl, setOpaApiKey,
  setElevenLabsApiKey, setElevenLabsVoiceId, setElevenLabsModel,
  setPostizApiUrl, setPostizApiKey,
} from "./lib/env";
import { testConnection } from "./queries/connection";

const t = initTRPC.create({ transformer: superjson });

const pingRouter = t.router({
  hello: t.procedure
    .input(z.object({ text: z.string() }))
    .query(({ input }) => ({ greeting: `pong ${input.text}` })),
});

const appRouter = router({
  sahiixx: sahiixxRouter,
  auth: authRouter,
  jarvis: jarvisRouter,
  documents: documentsRouter,
  ping: pingRouter,
});

export type AppRouter = typeof appRouter;

/** Cloudflare Hyperdrive binding shape (subset we use). */
type HyperdriveBinding = {
  connectionString: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

type Bindings = {
  DATABASE_URL?: string;
  /** Prefer Hyperdrive for edge Postgres (Neon via TCP pooler). */
  HYPERDRIVE?: HyperdriveBinding;
  AUTH_SECRET?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
  ASSETS?: { fetch: (req: Request) => Response };
  // Jarvis (realtime voice agent) — all optional; zero keys = local Ollama + browser TTS.
  OPENROUTER_API_KEY?: string;
  KIMI_API_KEY?: string;
  KIMI_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  RETELL_API_KEY?: string;
  OLLAMA_URL?: string;
  OLLAMA_API_KEY?: string;
  JARVIS_PROVIDER?: string;
  JARVIS_MODEL?: string;
  JARVIS_OLLAMA_MODEL?: string;
  OPA_DISPATCH_URL?: string;
  OPA_API_KEY?: string;
  // ElevenLabs (neural TTS for Jarvis voice) — optional.
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  ELEVENLABS_MODEL?: string;
  // Postiz (self-hostable social scheduler — SARA content factory backend). Optional.
  POSTIZ_API_URL?: string;
  POSTIZ_API_KEY?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Inject Cloudflare env into globalThis so lib/env + connection.ts can read it
app.use("*", async (c, next) => {
  // Prefer Hyperdrive connection string on Cloudflare (pooled TCP to Neon).
  if (c.env?.HYPERDRIVE?.connectionString) {
    setHyperdriveUrl(c.env.HYPERDRIVE.connectionString);
  } else if (c.env?.DATABASE_URL) {
    setDatabaseUrl(c.env.DATABASE_URL);
  }
  if (c.env?.AUTH_SECRET) setAuthSecret(c.env.AUTH_SECRET);
  if (c.env?.ADMIN_EMAIL && c.env?.ADMIN_PASSWORD) {
    setAdminCreds(c.env.ADMIN_EMAIL, c.env.ADMIN_PASSWORD);
  }
  // Jarvis env injection (Cloudflare path only; Vite dev reads .env via process.env).
  if (c.env?.OPENROUTER_API_KEY) setOpenRouterApiKey(c.env.OPENROUTER_API_KEY);
  if (c.env?.KIMI_API_KEY) setKimiApiKey(c.env.KIMI_API_KEY);
  if (c.env?.KIMI_BASE_URL) setKimiBaseUrl(c.env.KIMI_BASE_URL);
  if (c.env?.OPENAI_API_KEY) setOpenAiApiKey(c.env.OPENAI_API_KEY);
  if (c.env?.ANTHROPIC_API_KEY) setAnthropicApiKey(c.env.ANTHROPIC_API_KEY);
  if (c.env?.RETELL_API_KEY) setRetellApiKey(c.env.RETELL_API_KEY);
  if (c.env?.OLLAMA_URL) setOllamaUrl(c.env.OLLAMA_URL);
  if (c.env?.OLLAMA_API_KEY) setOllamaApiKey(c.env.OLLAMA_API_KEY);
  if (c.env?.JARVIS_PROVIDER) setJarvisProvider(c.env.JARVIS_PROVIDER);
  if (c.env?.JARVIS_MODEL) setJarvisModel(c.env.JARVIS_MODEL);
  if (c.env?.JARVIS_OLLAMA_MODEL) setJarvisOllamaModel(c.env.JARVIS_OLLAMA_MODEL);
  if (c.env?.OPA_DISPATCH_URL) setOpaDispatchUrl(c.env.OPA_DISPATCH_URL);
  if (c.env?.OPA_API_KEY) setOpaApiKey(c.env.OPA_API_KEY);
  if (c.env?.ELEVENLABS_API_KEY) setElevenLabsApiKey(c.env.ELEVENLABS_API_KEY);
  if (c.env?.ELEVENLABS_VOICE_ID) setElevenLabsVoiceId(c.env.ELEVENLABS_VOICE_ID);
  if (c.env?.ELEVENLABS_MODEL) setElevenLabsModel(c.env.ELEVENLABS_MODEL);
  if (c.env?.POSTIZ_API_URL) setPostizApiUrl(c.env.POSTIZ_API_URL);
  if (c.env?.POSTIZ_API_KEY) setPostizApiKey(c.env.POSTIZ_API_KEY);
  await next();
});

app.use("/*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

app.get("/api/health", (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString() })
);

app.all("/api/trpc/*", (c) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req: c.req.raw,
    createContext: async (): Promise<AuthContext> => {
      const authHeader = c.req.raw.headers.get("authorization");
      const user = await verifyBearer(authHeader);
      return { user };
    },
  })
);

// Jarvis realtime voice-agent routes (SSE turn + approve). Local-dev only —
// the tools they call are box-local (OPA :8082, WSL shell). See api/jarvis/*.
registerJarvisRoutes(app);

app.get("/api/env-check", (c) => {
  const hd = c.env?.HYPERDRIVE?.connectionString;
  const db = hd ?? c.env?.DATABASE_URL ?? process.env.DATABASE_URL;
  const envKeys = c.env ? Object.keys(c.env) : [];
  return c.json({
    hasDbUrl: !!db,
    hasHyperdrive: !!hd,
    dbMode: hd ? "hyperdrive" : db ? "neon-http" : "none",
    dbUrlPrefix: db ? db.substring(0, 20) + "..." : null,
    envKeys,
    hasProcessEnv: !!process.env.DATABASE_URL,
  });
});

app.get("/api/db-test", async (c) => {
  if (c.env?.HYPERDRIVE?.connectionString) {
    setHyperdriveUrl(c.env.HYPERDRIVE.connectionString);
  } else if (c.env?.DATABASE_URL) {
    setDatabaseUrl(c.env.DATABASE_URL);
  }
  const result = await testConnection();
  return c.json(result);
});

// On Cloudflare Pages, serve static assets for non-API routes
app.get("*", async (c) => {
  const assets = c.env?.ASSETS;
  if (assets) {
    return assets.fetch(c.req.raw);
  }
  return c.notFound();
});

export default app;