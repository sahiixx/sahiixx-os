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
import { systemRouter, APP_VERSION, APP_NAME } from "./system-router";
import { nexusRouter } from "./nexus-router";
import { registerJarvisRoutes } from "./jarvis/stream";
import { router, verifyBearer, type AuthContext } from "./context";
import { env } from "./lib/env";
import { withRequestBindings } from "./lib/runtime";
import { bodyLimit } from "hono/body-limit";
import { testConnection, getDb, activeDatabaseMode } from "./queries/connection";
import { agents } from "@db/schema";
import { inc, prometheusText } from "./lib/metrics";

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
  system: systemRouter,
  nexus: nexusRouter,
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

/** Minimal Workers AI binding surface we use for edge probe / fallback. */
type AiBinding = {
  run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
};

type Bindings = {
  DATABASE_URL?: string;
  /** Prefer Hyperdrive for edge Postgres (Neon via TCP pooler). */
  HYPERDRIVE?: HyperdriveBinding;
  /** Workers AI binding (wrangler [ai] binding = "AI") */
  AI?: AiBinding;
  APP_ENV?: string;
  AUTH_SECRET?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
  ASSETS?: { fetch: (req: Request) => Response };
  CF_PAGES?: string;
  // Jarvis (realtime voice agent) — all optional; zero keys = local Ollama + browser TTS.
  OPENROUTER_API_KEY?: string;
  XAI_API_KEY?: string;
  XAI_BASE_URL?: string;
  XAI_MODEL?: string;
  MIMO_API_KEY?: string;
  MIMO_BASE_URL?: string;
  MIMO_MODEL?: string;
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
  // Live NEXUS / sahiix-estate bridge
  ESTATE_API_URL?: string;
  ESTATE_API_KEY?: string;
  JARVIS_OS_AGENT_URL?: string;
  JARVIS_OS_TOKEN?: string;
  // Sovereign Revenue OS pipeline bridge (lead scoring/capture). Optional.
  REVENUE_API_URL?: string;
  REVENUE_API_KEY?: string;
  // FirstCall revenue API (lead capture). Optional; independent of the above.
  FIRSTCALL_URL?: string;
  FIRSTCALL_TOKEN?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Bindings belong to the request, never to the shared Worker global object.
app.use("*", (c, next) => {
  const values: Record<string, unknown> = c.env ? { ...c.env } : { ...process.env };
  values.APP_ENV ??= process.env.NODE_ENV === "production" ? "production" : "development";
  values.__DATABASE_URL = values.DATABASE_URL;
  values.__HYPERDRIVE_URL = c.env?.HYPERDRIVE?.connectionString;
  values.__WORKERS_AI = c.env?.AI;
  return withRequestBindings(values, async () => {
    inc("requests_total");
    await next();
  });
});
app.use("/api/*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Request-ID", crypto.randomUUID());
  if (["/api/env-check", "/api/db-test"].includes(c.req.path) && env.production) return c.notFound();
  if (c.req.path === "/api/metrics") {
    const user = await verifyBearer(c.req.header("authorization"));
    if (user?.role !== "admin") return c.json({ error: "Not authorized" }, 401);
  }
  await next();
});

// Security headers (API + SPA responses)
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  c.res.headers.set("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  c.res.headers.set("X-SAHIIXX-Version", APP_VERSION);
  c.res.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  if (env.production && new URL(c.req.url).protocol === "https:") c.res.headers.set("Strict-Transport-Security", "max-age=31536000");
});

app.use(
  "/*",
  cors({
    origin: (origin, c) => origin === new URL(c.req.url).origin ? origin : "",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["X-SAHIIXX-Version"],
  }),
);

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    name: APP_NAME,
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
  }),
);

/** K8s-style readiness: 200 only when DB answers. */
app.get("/api/ready", async (c) => {
  try {
    const db = getDb();
    await db.select().from(agents).limit(1);
    return c.json({
      status: "ready",
      version: APP_VERSION,
      dbMode: activeDatabaseMode(),
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return c.json(
      {
        status: "not_ready",
        version: APP_VERSION,
        error: "Database unavailable",
        timestamp: new Date().toISOString(),
      },
      503,
    );
  }
});

app.get("/api/version", (c) =>
  c.json({ name: APP_NAME, version: APP_VERSION, timestamp: new Date().toISOString() }),
);

app.get("/api/metrics", (c) => {
  const body = prometheusText({ db_mode: activeDatabaseMode() === "neon-http" ? 1 : 2 });
  return c.body(body, 200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
});

app.all("/api/trpc/*", (c) => {
  inc("trpc_total");
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req: c.req.raw,
    createContext: async (): Promise<AuthContext> => {
      const authHeader = c.req.raw.headers.get("authorization");
      const user = await verifyBearer(authHeader);
      return { user };
    },
  });
});

// Jarvis realtime voice-agent routes (SSE turn + approve). Local-dev only —
// the tools they call are box-local (OPA :8082, WSL shell). See api/jarvis/*.
registerJarvisRoutes(app);

app.get("/api/env-check", (c) => {
  const hd = c.env?.HYPERDRIVE?.connectionString;
  const dbSecret = c.env?.DATABASE_URL ?? process.env.DATABASE_URL;
  const envKeys = c.env ? Object.keys(c.env).sort() : [];
  const flag = (k: string) => !!(c.env as any)?.[k];
  return c.json({
    hasDbUrl: !!dbSecret,
    hasHyperdrive: !!hd,
    hasWorkersAi: !!c.env?.AI,
    dbMode: dbSecret ? "neon-http" : hd ? "hyperdrive" : "none",
    secretsPresent: {
      DATABASE_URL: flag("DATABASE_URL"),
      AUTH_SECRET: flag("AUTH_SECRET"),
      OLLAMA_URL: flag("OLLAMA_URL"),
      OLLAMA_API_KEY: flag("OLLAMA_API_KEY"),
      JARVIS_PROVIDER: flag("JARVIS_PROVIDER"),
      JARVIS_OLLAMA_MODEL: flag("JARVIS_OLLAMA_MODEL"),
      OPENROUTER_API_KEY: flag("OPENROUTER_API_KEY"),
      ELEVENLABS_API_KEY: flag("ELEVENLABS_API_KEY"),
      ESTATE_API_URL: flag("ESTATE_API_URL"),
    },
    envKeys,
    hasProcessEnv: !!process.env.DATABASE_URL,
    version: APP_VERSION,
  });
});

app.get("/api/db-test", async (c) => {
  // Middleware already injected env; just probe.
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