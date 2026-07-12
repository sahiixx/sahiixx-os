// Generic pending-op registry — the spine of every mutating action in Jarvis.
//
// service_control (start/stop), the tier-3 OS tools (file_delete, file_move,
// process_kill, power_action, system_setting network toggles), and win_script
// (raw PowerShell) ALL flow through here: register at tool-call time, show a
// CONFIRM button, execute the stored closure only after the client clicks.
//
// This replaces the service-control-specific `pending` Map that lived in
// tools.ts. The 5-minute TTL matches the original service_control behavior.

import { randomUUID } from "node:crypto";
import type { JarvisSession, PendingKind } from "./types";

export interface PendingOp {
  nonce: string;
  session: JarvisSession;
  kind: PendingKind; // "service" | "os" | "shell" — drives UI + speech
  label: string; // human-readable, shown on the CONFIRM button + spoken on success
  toolCallId: string;
  createdAt: number;
  execute: () => Promise<string>; // runs the op, returns its output string
}

const pending = new Map<string, PendingOp>();

/** Register a mutating op. Returns the nonce the client sends back on CONFIRM. */
export function registerPendingOp(
  session: JarvisSession,
  kind: PendingKind,
  label: string,
  execute: () => Promise<string>
): { nonce: string } {
  const nonce = randomUUID();
  pending.set(nonce, { nonce, session, kind, label, execute, toolCallId: randomUUID(), createdAt: Date.now() });
  // 5-min TTL — same as the original service_control gate.
  setTimeout(() => pending.delete(nonce), 5 * 60 * 1000);
  return { nonce };
}

/** Execute a previously-registered op after the client confirms. Pops the entry
 *  so it can only run once. `ok` is false if the output starts with "Error:". */
export async function runApproved(
  nonce: string
): Promise<{ ok: boolean; output: string; kind?: PendingKind; label?: string }> {
  const op = pending.get(nonce);
  if (!op) return { ok: false, output: "No pending operation for that token (it may have expired)." };
  pending.delete(nonce);
  try {
    const output = await op.execute();
    const ok = !/^Error:/.test(output);
    return { ok, output, kind: op.kind, label: op.label };
  } catch (e: any) {
    return { ok: false, output: `Error: ${e?.message ?? String(e)}`, kind: op.kind, label: op.label };
  }
}

/** All pending ops for a session (pushed as the `approvals` SSE event so the
 *  client's CONFIRM list stays in sync across tool rounds). */
export function pendingForSession(sessionId: string): Array<{ nonce: string; kind: PendingKind; label: string }> {
  const out: Array<{ nonce: string; kind: PendingKind; label: string }> = [];
  for (const op of pending.values()) {
    if (op.session.id === sessionId) out.push({ nonce: op.nonce, kind: op.kind, label: op.label });
  }
  return out;
}