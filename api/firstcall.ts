// FirstCall revenue API bridge client — pushes leads into the live FirstCall
// service (https://sahiixx-firstcall.fly.dev).
//
// Mirrors the graceful-degrade pattern of api/sovereign.ts: when FIRSTCALL_URL
// is unset every call returns null so the router can skip the external push
// without breaking the local write.
//
// NOTE this is a DIFFERENT service from the sovereign-revenue-os bridge above.
// sahiixx-firstcall exposes /health, /v1/leads, /v1/appointments, /v1/deals,
// /v1/commissions, /v1/metrics — it has NO /pipeline/process, so pointing
// REVENUE_API_URL at it 404s. Do not merge the two configs.
//
// The API expects: POST /v1/leads
//   header: Idempotency-Key: <stable key>   (optional but recommended)
//   header: X-Tenant-Id: <tenant>           (optional; body.tenant_id wins)
//   body:   { full_name?, name?, email?, phone?, transaction_type?, budget_min?,
//             budget_max?, currency?, contact_consent?, marketing_consent?,
//             source?, lead_id?, tenant_id?, cohort?, notes? }
// and returns { lead, events, duplicate, model }.
//
// Auth: the service currently has NO auth. FIRSTCALL_TOKEN is optional and sent
// as `Authorization: Bearer` when present, so adding bearer auth later needs
// no code change here.

import { env } from "./lib/env";

export function firstCallConfigured(): boolean {
  return !!env.firstCallUrl;
}

/** Root URL with any trailing slash removed. */
function baseUrl(): string {
  return (env.firstCallUrl || "").trim().replace(/\/+$/, "");
}

/**
 * Resolve the lead endpoint. Accepts EITHER form of FIRSTCALL_URL so operators
 * cannot get this wrong at the dashboard:
 *   https://host            -> https://host/v1/leads
 *   https://host/v1/leads   -> https://host/v1/leads   (used as-is)
 */
export function leadEndpoint(): string {
  const base = baseUrl();
  if (/\/v1\/leads$/.test(base)) return base;
  return `${base}/v1/leads`;
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
  lead_id?: string;
  tenant_id?: string;
  cohort?: string;
  notes?: string;
}

export interface FirstCallLeadResult {
  lead_id: string;
  status: string;
  score?: number;
  band?: string;
  duplicate: boolean;
  model?: string;
  raw?: any;
}

/** Channels the service accepts; anything else is coerced to "api" server-side. */
const KNOWN_SOURCES = new Set([
  "telegram", "web_form", "crm", "api", "voice", "whatsapp", "email", "internal",
]);

export async function pushLead(
  input: FirstCallLeadInput,
  opts?: { idempotencyKey?: string; tenantId?: string; timeoutMs?: number },
): Promise<FirstCallLeadResult | null> {
  if (!firstCallConfigured()) return null;
  const tenantId = opts?.tenantId || input.tenant_id || "default-tenant";
  const source = input.source && KNOWN_SOURCES.has(input.source) ? input.source : "internal";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  headers["X-Tenant-Id"] = tenantId;
  if (env.firstCallToken) headers["Authorization"] = `Bearer ${env.firstCallToken}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 10_000);
  try {
    const res = await fetch(leadEndpoint(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        full_name: input.full_name,
        name: input.name,
        email: input.email,
        phone: input.phone,
        transaction_type: input.transaction_type ?? "buy",
        budget_min: input.budget_min,
        budget_max: input.budget_max,
        currency: input.currency ?? "AED",
        contact_consent: input.contact_consent ?? true,
        marketing_consent: input.marketing_consent ?? false,
        source,
        lead_id: input.lead_id,
        tenant_id: tenantId,
        cohort: input.cohort ?? "ai_assisted",
        notes: input.notes,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`FirstCall /v1/leads ${res.status}: ${detail.slice(0, 200)}`);
    }
    const json: any = await res.json();
    const qual = json?.lead?.qualification ?? {};
    return {
      lead_id: json?.lead?.lead_id ?? "",
      status: json?.lead?.status ?? "unknown",
      score: qual?.score,
      band: qual?.band,
      duplicate: !!json?.duplicate,
      model: json?.model,
      raw: json,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Availability probe for a UI status badge. Mirrors probeSovereign().
export async function probeFirstCall(): Promise<{
  available: boolean;
  healthy: boolean;
  error: string | null;
}> {
  if (!firstCallConfigured()) return { available: false, healthy: false, error: null };
  try {
    const res = await fetch(`${baseUrl()}/health`, { method: "GET" });
    const json: any = await res.json().catch(() => ({}));
    return { available: true, healthy: json?.status === "ok", error: null };
  } catch (e: any) {
    return { available: true, healthy: false, error: (e?.message ?? String(e)).slice(0, 200) };
  }
}
