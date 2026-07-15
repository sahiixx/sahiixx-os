/**
 * Activity / audit log: try Neon first, fall back to in-memory ring buffer
 * so Status UI still works in demo mode.
 */
import { desc } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { activityEvents } from "@db/schema";

export type ActivityEvent = {
  id: number;
  actor: string | null;
  action: string;
  resource: string | null;
  detail: string | null;
  ip: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date | null;
};

const RING_MAX = 200;
let memSeq = 1;
const memRing: ActivityEvent[] = [];

export async function logActivity(input: {
  actor?: string | null;
  action: string;
  resource?: string | null;
  detail?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  const row: ActivityEvent = {
    id: memSeq++,
    actor: input.actor ?? null,
    action: input.action,
    resource: input.resource ?? null,
    detail: input.detail ?? null,
    ip: input.ip ?? null,
    meta: input.meta ?? null,
    createdAt: new Date(),
  };
  memRing.unshift(row);
  if (memRing.length > RING_MAX) memRing.length = RING_MAX;

  try {
    const db = getDb();
    await db.insert(activityEvents).values({
      actor: row.actor,
      action: row.action,
      resource: row.resource,
      detail: row.detail,
      ip: row.ip,
      meta: row.meta,
    });
  } catch {
    // Demo / table missing — memory ring is enough for this request lifecycle.
  }
}

export async function listActivity(limit = 50): Promise<{
  events: ActivityEvent[];
  source: "db" | "memory";
}> {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(activityEvents)
      .orderBy(desc(activityEvents.createdAt))
      .limit(Math.min(200, Math.max(1, limit)));
    return {
      events: rows.map((r) => ({
        id: r.id,
        actor: r.actor,
        action: r.action,
        resource: r.resource,
        detail: r.detail,
        ip: r.ip,
        meta: (r.meta as Record<string, unknown> | null) ?? null,
        createdAt: r.createdAt,
      })),
      source: "db",
    };
  } catch {
    return { events: memRing.slice(0, limit), source: "memory" };
  }
}
