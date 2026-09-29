/** FirstCall URL/token — kept separate so env.ts stays stable until full merge. */

function cleanEnv(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v)
    .replace(/^\uFEFF+/, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .trim();
  return s.length ? s : undefined;
}

function g(key: string): string | undefined {
  return cleanEnv((globalThis as any)[key]) ?? cleanEnv(process.env[key]);
}

export function getFirstcallUrl(): string {
  return g("FIRSTCALL_URL") ?? process.env.FIRSTCALL_URL ?? "";
}

export function getFirstcallToken(): string {
  return g("FIRSTCALL_TOKEN") ?? process.env.FIRSTCALL_TOKEN ?? "";
}

export function setFirstcallUrl(u: string) {
  (globalThis as any).FIRSTCALL_URL = cleanEnv(u) ?? "";
}

export function setFirstcallToken(k: string) {
  (globalThis as any).FIRSTCALL_TOKEN = cleanEnv(k) ?? "";
}
