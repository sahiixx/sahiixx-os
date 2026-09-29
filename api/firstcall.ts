/**
 * FirstCall revenue bridge — canonical lead → deal → commission path.
 * Prefer over sovereign-revenue-os for production attribution.
 * Contracts: https://github.com/sahiixx/sahiixx-production-hardening
 */

import { getFirstcallUrl, getFirstcallToken } from "./lib/firstcall-env";

export function firstcallConfigured(): boolean {
  return !!getFirstcallUrl();
}

function base(): string {
  return getFirstcallUrl().replace(/\/$/, "");
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    ...extra,
  };
  const token = getFirstcallToken();
  if (token) h["authorization"] = `Bearer ${token}`;
  return h;
}

export interface FirstCallLeadInput {
  full_name?: string;
  name?: string;
  email?: string;
  phone?: string;
  transaction_type?: string;
  budget_min?: number;
  budget_max?: number;
  currency?: string;
  contact_consent?: boolean;
  marketing_consent?: boolean;
  source?: string;
  tenant_id?: string;
  cohort?: "ai_assisted" | "human_only";
  lead_id?: string;
  idempotency_key?: string;
}

export async function ingestLead(input: FirstCallLeadInput): Promise<any | null> {
  if (!firstcallConfigured()) return null;
  const key =
    input.idempotency_key ||
    `os-lead:${input.tenant_id || "default"}:${input.phone || input.email || input.lead_id || Date.now()}`;
  const res = await fetch(`${base()}/v1/leads`, {
    method: "POST",
    headers: headers({
      "Idempotency-Key": key,
      "X-Tenant-Id": input.tenant_id || "default-tenant",
    }),
    body: JSON.stringify({
      full_name: input.full_name || input.name,
      name: input.name,
      email: input.email,
      phone: input.phone,
      transaction_type: input.transaction_type || "buy",
      budget_min: input.budget_min,
      budget_max: input.budget_max,
      currency: input.currency || "AED",
      contact_consent: input.contact_consent !== false,
      marketing_consent: Boolean(input.marketing_consent),
      source: input.source || "sahiixx-os",
      tenant_id: input.tenant_id || "default-tenant",
      cohort: input.cohort || "ai_assisted",
      lead_id: input.lead_id,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`FirstCall /v1/leads ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

export async function fetchMetrics(tenantId?: string): Promise<any | null> {
  if (!firstcallConfigured()) return null;
  const q = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
  const res = await fetch(`${base()}/v1/metrics${q}`, {
    method: "GET",
    headers: headers(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`FirstCall /v1/metrics ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

export async function probeFirstCall(): Promise<{
  available: boolean;
  healthy: boolean;
  error: string | null;
}> {
  if (!firstcallConfigured()) return { available: false, healthy: false, error: null };
  try {
    const res = await fetch(`${base()}/health`, { method: "GET" });
    const json: any = await res.json().catch(() => ({}));
    return {
      available: true,
      healthy: json?.status === "ok" || res.ok,
      error: null,
    };
  } catch (e: any) {
    return {
      available: true,
      healthy: false,
      error: (e?.message ?? String(e)).slice(0, 200),
    };
  }
}
