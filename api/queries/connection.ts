import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { env } from "../lib/env";
import * as schema from "@db/schema";

const fullSchema = { ...schema };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;

export function getDb() {
  if (!instance) {
    const url = env.databaseUrl;
    if (!url) throw new Error("DATABASE_URL is not set. Check Cloudflare Pages secrets.");
    const client = neon(url);
    instance = drizzle(client, { schema: fullSchema });
  }
  return instance;
}

// Direct test function
export async function testConnection() {
  const url = env.databaseUrl;
  if (!url) return { error: "DATABASE_URL not set" };
  try {
    const client = neon(url);
    const result = await client`SELECT 1 as test`;
    return { ok: true, result };
  } catch (e: any) {
    return { error: e.message, url_prefix: url.substring(0, 30) };
  }
}
