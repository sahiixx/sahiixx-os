// Minimal Postiz Public API client — the SARA content factory's scheduling backend.
// Docs: https://docs.postiz.com/public-api
//   GET  /integrations          → connected social channels (each has `id`)
//   POST /posts                 → create/schedule a post
//   DELETE /posts/{id}          → delete (404 = already deleted, safe to ignore)
// Auth: `Authorization: <api-key>` header (no Bearer prefix; OAuth tokens pos_* work too).
//
// Everything returns null when Postiz isn't configured (no URL/key) so the
// router can surface a clean "not connected" state to the UI — same graceful
// pattern as the Neon demo fallback and the ElevenLabs voice picker.

import { env } from "./lib/env";

export function postizConfigured(): boolean {
  return !!(env.postizApiUrl && env.postizApiKey);
}

export interface PostizIntegration {
  id: string;
  name?: string;
  type?: string; // platform key — x, linkedin, instagram, ... (maps to settings.__type)
  // Postiz returns more fields; we only surface what the UI needs.
}

export interface PostizPostInput {
  integrationId: string;
  platformType: string; // settings.__type
  content: string;
  type: "now" | "schedule";
  date?: string; // ISO 8601, required when type === "schedule"
  tags?: string[];
}

function headers(): Record<string, string> {
  return { Authorization: env.postizApiKey ?? "", "Content-Type": "application/json" };
}

export async function listIntegrations(): Promise<PostizIntegration[] | null> {
  if (!postizConfigured()) return null;
  const url = `${env.postizApiUrl.replace(/\/$/, "")}/integrations`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Postiz /integrations ${res.status}`);
  const json: any = await res.json();
  // Response shape isn't strictly documented; tolerate array or {integrations:[]}.
  const arr: any[] = Array.isArray(json) ? json : (json.integrations ?? json.data ?? []);
  return arr.map((i: any) => ({
    id: String(i.id ?? i.integrationId ?? ""),
    name: i.name ?? i.username ?? i.handle ?? i.identifier,
    type: i.type ?? i.provider ?? i.platform ?? "",
  }));
}

export async function createPost(input: PostizPostInput): Promise<{ id?: string; ok: boolean }> {
  if (!postizConfigured()) throw new Error("Postiz not configured");
  const url = `${env.postizApiUrl.replace(/\/$/, "")}/posts`;
  const body = {
    type: input.type,
    date: input.date ?? new Date().toISOString(),
    shortLink: false,
    tags: input.tags ?? [],
    posts: [
      {
        integration: { id: input.integrationId },
        value: [{ content: input.content, image: [] }],
        settings: { __type: input.platformType },
      },
    ],
  };
  const res = await fetch(url, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Postiz /posts ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json: any = await res.json().catch(() => ({}));
  return { id: json?.id != null ? String(json.id) : undefined, ok: true };
}

export async function deletePost(id: string): Promise<boolean> {
  if (!postizConfigured()) return false;
  const url = `${env.postizApiUrl.replace(/\/$/, "")}/posts/${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: "DELETE", headers: headers() });
  // 404 = already deleted, safe to ignore per docs.
  return res.ok || res.status === 404;
}

// One-shot availability probe used by postizStatus.
export async function probePostiz(): Promise<{ available: boolean; channels: number; error: string | null }> {
  if (!postizConfigured()) return { available: false, channels: 0, error: null };
  try {
    const list = await listIntegrations();
    return { available: true, channels: list?.length ?? 0, error: null };
  } catch (e: any) {
    return { available: false, channels: 0, error: (e?.message ?? String(e)).slice(0, 200) };
  }
}