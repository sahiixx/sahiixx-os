// Sovereign Revenue OS bridge client — pushes scored leads into the live
// sovereign-revenue-os pipeline (https://sovereign-revenue-os.fly.dev).
// Mirrors the graceful-degrade pattern of api/postiz.ts: when REVENUE_API_URL
// / REVENUE_API_KEY are unset, every call returns null so the router can skip
// the external push without breaking the local write.
//
// The sovereign API expects: POST /pipeline/process
//   header: X-API-Key: <REVENUE_API_KEY>
//   body:   { message, name?, phone?, email?, source?, budget_min?, budget_max?, buyer_type? }
// and returns a scored lead envelope ({ lead_id, score, status, contact, ... }).

import { env } from "./lib/env";

export function sovereignConfigured(): boolean {
  return !!(env.revenueApiUrl && env.revenueApiKey);
}

export interface SovereignLeadInput {
  message: string;
  name?: string;
  phone?: string;
  email?: string;
  source?: string;
  budget_min?: number;
  budget_max?: number;
  buyer_type?: string;
}

export interface SovereignLeadResult {
  lead_id: string;
  status: string;
  score?: number;
  next_action?: string;
  raw?: any;
}

export async function ingestLead(input: SovereignLeadInput): Promise<SovereignLeadResult | null> {
  if (!sovereignConfigured()) return null;
  const base = env.revenueApiUrl!.replace(/\/$/, "");
  const res = await fetch(`${base}/pipeline/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": env.revenueApiKey!,
    },
    body: JSON.stringify({
      message: input.message,
      name: input.name,
      phone: input.phone,
      email: input.email,
      source: input.source ?? "sahiixx-os",
      budget_min: input.budget_min,
      budget_max: input.budget_max,
      buyer_type: input.buyer_type,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Sovereign /pipeline/process ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json: any = await res.json();
  return {
    lead_id: json?.lead_id ?? "",
    status: json?.status ?? "unknown",
    score: json?.score?.score,
    next_action: json?.next_action,
    raw: json,
  };
}

// Availability probe for a UI status badge.
export async function probeSovereign(): Promise<{ available: boolean; healthy: boolean; error: string | null }> {
  if (!sovereignConfigured()) return { available: false, healthy: false, error: null };
  try {
    const base = env.revenueApiUrl!.replace(/\/$/, "");
    const res = await fetch(`${base}/health`, { method: "GET" });
    const json: any = await res.json().catch(() => ({}));
    return { available: true, healthy: json?.status === "healthy", error: null };
  } catch (e: any) {
    return { available: true, healthy: false, error: (e?.message ?? String(e)).slice(0, 200) };
  }
}
