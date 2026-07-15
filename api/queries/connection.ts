/**
 * DB access for Neon (HTTP) and Hyperdrive (TCP via postgres.js on CF).
 *
 * Production (Pages): prefer Neon HTTP — stateless, no pool poisoning on Workers.
 * Hyperdrive: optional fallback when only HYPERDRIVE is bound (no DATABASE_URL).
 * Local Vite: Neon HTTP via process.env.DATABASE_URL.
 */
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgresJs } from "drizzle-orm/postgres-js";
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";
import { env } from "../lib/env";
import * as schema from "@db/schema";

const fullSchema = { ...schema };

type DbInstance =
  | ReturnType<typeof drizzleNeonHttp<typeof fullSchema>>
  | ReturnType<typeof drizzlePostgresJs<typeof fullSchema>>;

let neonInstance: DbInstance | undefined;
/** Hyperdrive clients must not be long-lived singletons on Workers — see getDb(). */

function hyperdriveUrl(): string | undefined {
  return (globalThis as any).__HYPERDRIVE_URL as string | undefined;
}

/** True Neon URL (not a Hyperdrive local/proxy string). */
function neonDatabaseUrl(): string | undefined {
  const u = env.databaseUrl;
  if (!u) return undefined;
  // Hyperdrive connection strings often use opaque hosts / user ids, not neon.tech.
  // Prefer real Neon URLs for the HTTP driver.
  if (/neon\.tech/i.test(u) || /@ep-/i.test(u)) return u;
  // If no Hyperdrive bound, any DATABASE_URL is fine for neon-http.
  if (!hyperdriveUrl()) return u;
  return u.includes("neon") ? u : undefined;
}

export function getDb() {
  const neonUrl = neonDatabaseUrl() ?? (hyperdriveUrl() ? undefined : env.databaseUrl);
  const hd = hyperdriveUrl();

  // 1) Neon HTTP when we have a usable URL (stable on Pages; no TCP pool).
  if (neonUrl && (/neon\.tech/i.test(neonUrl) || !hd)) {
    if (!neonInstance) {
      const client = neon(neonUrl);
      neonInstance = drizzleNeonHttp(client, { schema: fullSchema });
    }
    return neonInstance;
  }

  // 2) Hyperdrive: create a short-lived client per call (Workers-safe).
  //    Avoid module-level pool — concurrent requests + stale sockets → 1101.
  if (hd) {
    const sql = postgres(hd, {
      max: 1,
      fetch_types: false,
      prepare: false,
      idle_timeout: 5,
      connect_timeout: 10,
    });
    return drizzlePostgresJs(sql, { schema: fullSchema });
  }

  // 3) Last resort: plain DATABASE_URL via neon-http
  const url = env.databaseUrl;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Check Cloudflare secrets or HYPERDRIVE binding.",
    );
  }
  if (!neonInstance) {
    const client = neon(url);
    neonInstance = drizzleNeonHttp(client, { schema: fullSchema });
  }
  return neonInstance;
}

export function activeDatabaseMode(): "hyperdrive-pg" | "neon-http" | "none" {
  if (neonDatabaseUrl() && (/neon\.tech/i.test(neonDatabaseUrl()!) || !hyperdriveUrl())) {
    return "neon-http";
  }
  if (hyperdriveUrl() && !neonDatabaseUrl()) return "hyperdrive-pg";
  if (env.databaseUrl) return "neon-http";
  if (hyperdriveUrl()) return "hyperdrive-pg";
  return "none";
}

export async function testConnection() {
  const hd = hyperdriveUrl();
  const neonUrl = neonDatabaseUrl() ?? env.databaseUrl;
  const url = neonUrl || hd;
  if (!url) return { error: "DATABASE_URL / HYPERDRIVE not set", mode: activeDatabaseMode() };

  const out: Record<string, unknown> = { mode: activeDatabaseMode() };

  // Probe Neon HTTP first when available
  if (neonUrl) {
    try {
      const client = neon(neonUrl);
      const result = await client`SELECT 1 as test`;
      let agentsRaw: unknown = null;
      let agentsErr: string | null = null;
      try {
        agentsRaw = await client`SELECT id, name, status FROM agents ORDER BY id LIMIT 3`;
      } catch (e: any) {
        agentsErr = e?.message ?? String(e);
      }
      out.ok = true;
      out.neonHttp = { result, agentsRaw, agentsErr, prefix: neonUrl.substring(0, 28) };
    } catch (e: any) {
      out.neonHttp = { error: e.message, prefix: neonUrl.substring(0, 28) };
    }
  }

  // Probe Hyperdrive without holding a long-lived pool
  if (hd) {
    const client = postgres(hd, { max: 1, fetch_types: false, prepare: false, connect_timeout: 10 });
    try {
      const rows = await client`SELECT 1 as test`;
      let agentsRaw: unknown = null;
      let agentsErr: string | null = null;
      try {
        agentsRaw = await client`SELECT id, name, status FROM agents ORDER BY id LIMIT 3`;
      } catch (e: any) {
        agentsErr = [e?.message, e?.cause?.message].filter(Boolean).join(" | ");
      }
      out.ok = out.ok || true;
      out.hyperdrive = { result: rows, agentsRaw, agentsErr };
    } catch (e: any) {
      out.hyperdrive = { error: e.message };
    } finally {
      try {
        await client.end({ timeout: 2 });
      } catch {
        /* ignore */
      }
    }
  }

  if (!out.ok && !out.neonHttp && !out.hyperdrive) {
    return { error: "no probe ran", mode: activeDatabaseMode(), url_prefix: url.substring(0, 30) };
  }
  return out;
}
