/**
 * DB access for Neon (HTTP, local/dev) and Hyperdrive (TCP via pg, Cloudflare).
 *
 * - Local / Vite: @neondatabase/serverless neon() + drizzle neon-http
 * - Cloudflare with HYPERDRIVE binding: node-postgres Pool + drizzle node-postgres
 */
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { neon } from "@neondatabase/serverless";
import pg from "pg";
import { env } from "../lib/env";
import * as schema from "@db/schema";

const fullSchema = { ...schema };

type DbInstance =
  | ReturnType<typeof drizzleNeonHttp<typeof fullSchema>>
  | ReturnType<typeof drizzleNodePg<typeof fullSchema>>;

let instance: DbInstance | undefined;
let instanceMode: "neon-http" | "hyperdrive-pg" | undefined;
let pool: pg.Pool | undefined;

function hyperdriveUrl(): string | undefined {
  return (globalThis as any).__HYPERDRIVE_URL as string | undefined;
}

export function getDb() {
  const hd = hyperdriveUrl();
  const mode: "neon-http" | "hyperdrive-pg" = hd ? "hyperdrive-pg" : "neon-http";

  // Recreate if mode flipped (e.g. cold start vs local)
  if (instance && instanceMode !== mode) {
    instance = undefined;
    void pool?.end().catch(() => {});
    pool = undefined;
  }

  if (!instance) {
    if (mode === "hyperdrive-pg" && hd) {
      pool = new pg.Pool({
        connectionString: hd,
        // Hyperdrive manages pooling; keep Worker-side pool small.
        max: 5,
        // Required for some edge runtimes with short-lived isolates.
        connectionTimeoutMillis: 10_000,
      });
      instance = drizzleNodePg(pool, { schema: fullSchema });
      instanceMode = "hyperdrive-pg";
    } else {
      const url = env.databaseUrl;
      if (!url) {
        throw new Error("DATABASE_URL is not set. Check Cloudflare Pages secrets or HYPERDRIVE binding.");
      }
      const client = neon(url);
      instance = drizzleNeonHttp(client, { schema: fullSchema });
      instanceMode = "neon-http";
    }
  }
  return instance;
}

/** Prefer Hyperdrive connection string when present (Workers). */
export function activeDatabaseMode(): "hyperdrive-pg" | "neon-http" | "none" {
  if (hyperdriveUrl()) return "hyperdrive-pg";
  if (env.databaseUrl) return "neon-http";
  return "none";
}

// Direct test function
export async function testConnection() {
  const hd = hyperdriveUrl();
  const url = hd || env.databaseUrl;
  if (!url) return { error: "DATABASE_URL / HYPERDRIVE not set", mode: activeDatabaseMode() };
  try {
    if (hd) {
      const client = new pg.Client({ connectionString: hd });
      await client.connect();
      const result = await client.query("SELECT 1 as test");
      await client.end();
      return { ok: true, mode: "hyperdrive-pg" as const, result: result.rows };
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
