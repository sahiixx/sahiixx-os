/**
 * System ops surface: version, readiness, integration matrix, activity feed, metrics.
 * Built so the Status page and external monitors share one source of truth.
 */
import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "./context";
import { env } from "./lib/env";
import { getDb, activeDatabaseMode, testConnection } from "./queries/connection";
import { agents } from "@db/schema";
import { listActivity, logActivity } from "./lib/activity";
import { getCounters, getUptimeSec } from "./lib/metrics";
import { sql } from "drizzle-orm";

export const APP_VERSION = "4.1.0";
export const APP_NAME = "sahiixx-os";

async function probeOpa(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const url = env.opaDispatchUrl?.replace(/\/dispatch\/?$/, "") || "http://127.0.0.1:8082";
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return { ok: res.ok || res.status < 500, latencyMs: Date.now() - start };
  } catch (e: any) {
    return { ok: false, latencyMs: Date.now() - start, error: (e?.message ?? String(e)).slice(0, 120) };
  }
}

export const systemRouter = router({
  version: publicProcedure.query(() => ({
    name: APP_NAME,
    version: APP_VERSION,
    node: typeof process !== "undefined" ? process.version : "workers",
    uptimeSec: getUptimeSec(),
  })),

  /** Full readiness: DB + mode + optional OPA (local only usually fails on Pages). */
  status: publicProcedure.query(async () => {
    let dbOk = false;
    let dbError: string | null = null;
    let agentCount: number | null = null;
    try {
      const db = getDb();
      const rows = await db.select({ n: sql<number>`count(*)::int` }).from(agents);
      agentCount = Number(rows[0]?.n ?? 0);
      dbOk = true;
    } catch (e: any) {
      dbError = (e?.message ?? String(e)).slice(0, 200);
    }

    const mode = activeDatabaseMode();
    const opa = await probeOpa();

    const integrations = {
      database: { configured: !!(env.databaseUrl || (globalThis as any).__HYPERDRIVE_URL), ok: dbOk, mode, error: dbError, agentCount },
      auth: { configured: true, hasCustomSecret: !!((globalThis as any).AUTH_SECRET || process.env.AUTH_SECRET) },
      openrouter: { configured: !!env.openRouterApiKey },
      kimi: { configured: !!env.kimiApiKey },
      openai: { configured: !!env.openAiApiKey },
      anthropic: { configured: !!env.anthropicApiKey },
      ollama: { configured: !!env.ollamaUrl, url: env.ollamaUrl ? env.ollamaUrl.replace(/\/\/.*@/, "//***@") : null, hasApiKey: !!env.ollamaApiKey },
      elevenlabs: { configured: !!env.elevenLabsApiKey },
      postiz: { configured: !!(env.postizApiUrl && env.postizApiKey) },
      opa: { configured: !!env.opaDispatchUrl, ...opa },
    };

    const criticalOk = dbOk;
    return {
      status: criticalOk ? ("ready" as const) : ("degraded" as const),
      version: APP_VERSION,
      name: APP_NAME,
      uptimeSec: getUptimeSec(),
      timestamp: new Date().toISOString(),
      integrations,
      demo: !dbOk,
    };
  }),

  integrations: publicProcedure.query(async () => {
    // Lightweight subset for polling without OPA fetch on every tick
    return {
      database: !!(env.databaseUrl || (globalThis as any).__HYPERDRIVE_URL),
      openrouter: !!env.openRouterApiKey,
      kimi: !!env.kimiApiKey,
      openai: !!env.openAiApiKey,
      anthropic: !!env.anthropicApiKey,
      ollama: !!env.ollamaUrl,
      elevenlabs: !!env.elevenLabsApiKey,
      postiz: !!(env.postizApiUrl && env.postizApiKey),
      opa: !!env.opaDispatchUrl,
      dbMode: activeDatabaseMode(),
    };
  }),

  activityList: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
    .query(async ({ input }) => {
      return listActivity(input?.limit ?? 50);
    }),

  metrics: publicProcedure.query(() => ({
    uptimeSec: getUptimeSec(),
    counters: getCounters(),
    version: APP_VERSION,
  })),

  /** Admin-only: force a DB probe + write a heartbeat event. */
  heartbeat: protectedProcedure.mutation(async ({ ctx }) => {
    const probe = await testConnection();
    await logActivity({
      actor: ctx.user.email,
      action: "system.heartbeat",
      resource: "system",
      detail: JSON.stringify({ ok: !!(probe as any).ok, mode: (probe as any).mode }),
    });
    return { ok: true, probe };
  }),
});
