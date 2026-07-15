/**
 * DB access for Neon (HTTP, local/dev) and Hyperdrive (TCP via postgres.js on CF).
 *
 * - Local / Vite: @neondatabase/serverless neon() + drizzle neon-http
 * - Cloudflare with HYPERDRIVE: postgres.js + drizzle postgres-js (Workers-safe)
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

let instance: DbInstance | undefined;
let instanceMode: "neon-http" | "hyperdrive-pg" | undefined;
let sql: ReturnType<typeof postgres> | undefined;

function hyperdriveUrl(): string | undefined {
  return (globalThis as any).__HYPERDRIVE_URL as string | undefined;
}

export function getDb() {
  const hd = hyperdriveUrl();
  const mode: "neon-http" | "hyperdrive-pg" = hd ? "hyperdrive-pg" : "neon-http";

  if (instance && instanceMode !== mode) {
    instance = undefined;
    void sql?.end({ timeout: 1 }).catch(() => {});
    sql = undefined;
  }

  if (!instance) {
    if (mode === "hyperdrive-pg" && hd) {
      // postgres.js works on Cloudflare Workers + Hyperdrive (TCP).
      sql = postgres(hd, {
        max: 5,
        fetch_types: false,
        prepare: false, // Hyperdrive / edge: prefer simple queries
      });
      instance = drizzlePostgresJs(sql, { schema: fullSchema });
      instanceMode = "hyperdrive-pg";
    } else {
      const url = env.databaseUrl;
      if (!url) {
        throw new Error(
          "DATABASE_URL is not set. Check Cloudflare secrets or HYPERDRIVE binding.",
        );
      }
      const client = neon(url);
      instance = drizzleNeonHttp(client, { schema: fullSchema });
      instanceMode = "neon-http";
    }
  }
  return instance;
}

export function activeDatabaseMode(): "hyperdrive-pg" | "neon-http" | "none" {
  if (hyperdriveUrl()) return "hyperdrive-pg";
  if (env.databaseUrl) return "neon-http";
  return "none";
}

export async function testConnection() {
  const hd = hyperdriveUrl();
  const url = hd || env.databaseUrl;
  if (!url) return { error: "DATABASE_URL / HYPERDRIVE not set", mode: activeDatabaseMode() };
  try {
    if (hd) {
      const client = postgres(hd, { max: 1, fetch_types: false, prepare: false });
      try {
        const rows = await client`SELECT 1 as test`;
        return { ok: true, mode: "hyperdrive-pg" as const, result: rows };
      } finally {
        await client.end({ timeout: 2 });
      }
    }
    const client = neon(url);
    const result = await client`SELECT 1 as test`;
    return { ok: true, mode: "neon-http" as const, result };
  } catch (e: any) {
    return {
      error: e.message,
      mode: activeDatabaseMode(),
      url_prefix: url.substring(0, 30),
    };
  }
}
