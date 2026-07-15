/**
 * Bridge to the live WSL NEXUS / sahiix-estate API (ports 3001).
 * Cloudflare cannot reach localhost — set ESTATE_API_URL for prod (tunnel).
 */
import { env } from "./env";

export type EstateLead = {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  property_id?: number | null;
  status?: string | null;
  notes?: string | null;
  created_at?: string | null;
  property_title?: string | null;
};

function baseUrl(): string {
  return (env.estateApiUrl || "").replace(/\/$/, "");
}

export function estateConfigured(): boolean {
  return !!baseUrl();
}

async function estateFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = baseUrl();
  if (!base) throw new Error("ESTATE_API_URL not configured");
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (env.estateApiKey) headers.set("Authorization", `Bearer ${env.estateApiKey}`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    return await fetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
      ...init,
      headers,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

export async function estateHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  body?: unknown;
  error?: string;
  url: string;
}> {
  const url = baseUrl() || "(not set)";
  if (!baseUrl()) {
    return { ok: false, latencyMs: 0, error: "ESTATE_API_URL not set", url };
  }
  const start = Date.now();
  try {
    const res = await estateFetch("/health");
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return {
      ok: res.ok,
      latencyMs: Date.now() - start,
      body,
      url,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (e: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: (e?.message ?? String(e)).slice(0, 160),
      url,
    };
  }
}

export async function estateLeads(): Promise<{
  ok: boolean;
  leads: EstateLead[];
  error?: string;
}> {
  if (!baseUrl()) return { ok: false, leads: [], error: "ESTATE_API_URL not set" };
  try {
    const res = await estateFetch("/leads");
    if (!res.ok) return { ok: false, leads: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    const leads = Array.isArray(data) ? data : (data as any).leads ?? [];
    return { ok: true, leads };
  } catch (e: any) {
    return { ok: false, leads: [], error: (e?.message ?? String(e)).slice(0, 160) };
  }
}
