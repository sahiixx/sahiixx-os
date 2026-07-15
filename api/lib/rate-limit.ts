/**
 * Sliding-window rate limiter.
 * - In-memory (fast, per-isolate) always.
 * - Optional Cache API backup on Cloudflare so cold starts share a soft limit.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

function memLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  const remaining = Math.max(0, limit - b.count);
  if (b.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
    };
  }
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (now >= v.resetAt) buckets.delete(k);
    }
  }
  return { allowed: true, remaining, retryAfterSec: 0 };
}

/** Prefer calling this from auth.login — async for Cache API. */
export async function rateLimitAsync(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  // 1) Memory gate (cheap)
  const mem = memLimit(key, limit, windowMs);
  if (!mem.allowed) return mem;

  // 2) Cache API soft-share across isolates (best-effort)
  try {
    const cachesObj = (globalThis as any).caches;
    if (!cachesObj?.default) return mem;
    const cache: Cache = cachesObj.default;
    const url = `https://sahiixx-os.rate-limit.internal/${encodeURIComponent(key)}`;
    const hit = await cache.match(url);
    let count = 1;
    let resetAt = Date.now() + windowMs;
    if (hit) {
      const j = (await hit.json()) as { count: number; resetAt: number };
      if (Date.now() < j.resetAt) {
        count = (j.count ?? 0) + 1;
        resetAt = j.resetAt;
      }
    }
    const body = JSON.stringify({ count, resetAt });
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": `max-age=${Math.max(1, Math.ceil(windowMs / 1000))}`,
    });
    await cache.put(url, new Response(body, { headers }));
    if (count > limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
      };
    }
    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      retryAfterSec: 0,
    };
  } catch {
    return mem;
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  return memLimit(key, limit, windowMs);
}
