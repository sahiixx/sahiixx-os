// Jarvis tool registry + executors. These are the "100x" — what makes Jarvis an
// agent (it can DO things) rather than a chatbot. v1 ships three core tools:
//   opa_dispatch    — route any NL intent through OPA's 170+ repo router (:8082)
//   nexus_query     — read-only deals/contacts lookup (in-app Neon)
//   service_control — start/stop/status for the 5 SAHIIX WSL services (gated)
// Plus the Windows OS-control tools (os.ts): ~18 bounded tools + win_script.
// shell_run from the original v1.1 list is now win_script (gated + blocklisted).
//
// Every executor is wrapped in try/catch and returns a clean string so a tool
// failure never crashes the SSE stream — the LLM just gets "Error: ..." and
// narrates it. Mutating ops that need a confirmation click flow through the
// generic pending-op registry in approvals.ts (shared with os.ts + win_script).
//
// LOCAL-DEV ONLY: opa_dispatch hits localhost:8082, service_control shells out
// to wsl.exe, and the os.* tools shell out to powershell.exe — none are
// reachable from a Cloudflare Worker. Jarvis runs in `npm run dev` where Hono
// is on the box and can reach all of them.

import { execFileSync } from "node:child_process";
import { env } from "../lib/env";
import { getDb } from "../queries/connection";
import { deals, contacts } from "@db/schema";
import { desc, like } from "drizzle-orm";
import type { JarvisSession, ToolDef, ToolExecResult } from "./types";
import { registerPendingOp } from "./approvals";
import { OS_TOOLS, executeOsTool } from "./os";

const SERVICE_ALLOW = ["sahiix-os", "estate-api", "estate-whatsapp", "sahiix-voice", "openclaw-gateway"] as const;
type ServiceName = (typeof SERVICE_ALLOW)[number];
const VERB_ALLOW = ["start", "stop", "status"] as const;
type Verb = (typeof VERB_ALLOW)[number];

const BASE_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "opa_dispatch",
      description:
        "Dispatch a natural-language intent through the One Person Agency (OPA) router, which auto-selects the best of 170+ GitHub modules and runs it. Use for ANY task that should be delegated to the agency: research, scraping, codegen, signal collection, workflow runs, etc. Returns the task result.",
      parameters: {
        type: "object",
        properties: {
          intent: { type: "string", description: "Natural-language description of what to do, e.g. 'summarize latest signals' or 'scrape the top 10 AI startups in Dubai'." },
          payload: { type: "object", description: "Optional structured payload for the task.", additionalProperties: true },
        },
        required: ["intent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "nexus_query",
      description:
        "Read-only query of the NEXUS deal/contact database. List top deals (by score) or search contacts by name. Use when the user asks about their pipeline, deals, contacts, or CRM data.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["deals", "contacts"], description: "Which list to query." },
          search: { type: "string", description: "Optional substring to filter contact names by (deals ignore this)." },
          limit: { type: "number", description: "Max rows to return (default 10)." },
        },
        required: ["kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "service_control",
      description:
        "Check the status of, start, or stop one of the SAHIIX WSL services: sahiix-os, estate-api, estate-whatsapp, sahiix-voice, openclaw-gateway. 'status' runs immediately; 'start'/'stop' REQUIRE the user to have enabled service control AND to confirm via a click (the assistant will ask for confirmation).",
      parameters: {
        type: "object",
        properties: {
          verb: { type: "string", enum: ["start", "stop", "status"] },
          service: { type: "string", enum: [...SERVICE_ALLOW] },
        },
        required: ["verb", "service"],
      },
    },
  },
];

/** Full tool set exposed to the LLM: the three core tools + the OS-control layer. */
export const TOOLS: ToolDef[] = [...BASE_TOOLS, ...OS_TOOLS];

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  session: JarvisSession
): Promise<ToolExecResult> {
  try {
    switch (name) {
      case "opa_dispatch":
        return { result: await opaDispatch(args) };
      case "nexus_query":
        return { result: await nexusQuery(args) };
      case "service_control":
        return serviceControl(args, session);
      default:
        // Everything else is an OS-control tool (or win_script) handled in os.ts.
        return await executeOsTool(name, args, session);
    }
  } catch (e: any) {
    return { result: `Error: ${e?.message ?? String(e)}` };
  }
}

// ── opa_dispatch ────────────────────────────────────────────────────────────
async function opaDispatch(args: Record<string, unknown>): Promise<string> {
  const intent = String(args.intent ?? "").trim();
  if (!intent) return "Error: opa_dispatch requires an 'intent' string.";
  const payload = (args.payload && typeof args.payload === "object" ? args.payload : {}) as Record<string, unknown>;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.opaApiKey) headers["X-OPA-API-Key"] = env.opaApiKey;
  const res = await fetch(env.opaDispatchUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ intent, payload }),
  });
  if (!res.ok) return `Error: OPA dispatch failed (HTTP ${res.status}): ${await res.text().catch(() => "")}`.slice(0, 800);
  const task = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const summary = {
    task_id: task.id ?? task.task_id,
    status: task.status,
    module: task.module_id ?? task.module,
    category: task.category,
    result: task.result,
    error: task.error,
  };
  return JSON.stringify(summary).slice(0, 1200);
}

// ── nexus_query (read-only) ─────────────────────────────────────────────────
async function nexusQuery(args: Record<string, unknown>): Promise<string> {
  const kind = String(args.kind ?? "");
  const limit = Math.min(Number(args.limit ?? 10) || 10, 25);
  const db = getDb();
  if (kind === "deals") {
    const rows = await db.select().from(deals).orderBy(desc(deals.score)).limit(limit);
    return JSON.stringify(rows).slice(0, 1500) || "No deals found.";
  }
  if (kind === "contacts") {
    const search = String(args.search ?? "").trim();
    const q = db.select().from(contacts).limit(limit);
    const rows = search
      ? await db.select().from(contacts).where(like(contacts.name, `%${search}%`)).limit(limit)
      : await q;
    return JSON.stringify(rows).slice(0, 1500) || "No contacts found.";
  }
  return "Error: nexus_query 'kind' must be 'deals' or 'contacts'.";
}

// ── service_control ──────────────────────────────────────────────────────────
function serviceControl(args: Record<string, unknown>, session: JarvisSession): ToolExecResult {
  const verb = String(args.verb ?? "") as Verb;
  const service = String(args.service ?? "") as ServiceName;
  if (!VERB_ALLOW.includes(verb)) return { result: `Error: verb must be one of ${VERB_ALLOW.join(", ")}.` };
  if (!SERVICE_ALLOW.includes(service)) return { result: `Error: service must be one of ${SERVICE_ALLOW.join(", ")}.` };

  if (verb === "status") {
    // Read-only — run immediately, no approval.
    return { result: runWsl(verb, service) };
  }

  // Mutating (start/stop): require the session toggle AND a confirmation click.
  if (!session.allowShell) {
    return {
      result: `Service control is not enabled. Ask the user to toggle "Allow service control" on, then confirm the ${verb} of ${service}.`,
    };
  }
  const label = `${verb.toUpperCase()} ${service}`;
  const { nonce } = registerPendingOp(session, "service", label, async () => runWsl(verb, service));
  return {
    result: `Awaiting user confirmation to ${verb} ${service}. A CONFIRM button has been shown to the user; nothing will run until they click it.`,
    approval: { nonce, kind: "service", label },
  };
}

function runWsl(verb: Verb, service: string): string {
  // execFile (not exec) — no shell, so whitelisted verb/service can't be escaped.
  // Args are passed as a literal argv array; user text never reaches the shell.
  try {
    const out = execFileSync("wsl.exe", ["-d", "Ubuntu-24.04", "--", "systemctl", "--user", verb, service], {
      timeout: 15000,
      encoding: "utf8",
    });
    return (out || `(no output) — ${service} ${verb} OK`).trim().slice(0, 600);
  } catch (e: any) {
    const stderr = (e?.stderr ?? "").toString().trim();
    const stdout = (e?.stdout ?? "").toString().trim();
    // systemctl status returns non-zero when a service is inactive — that's not an error.
    if (verb === "status" && stderr.includes("inactive")) {
      return `${service}: inactive (stopped)`;
    }
    if (verb === "status" && /Loaded:\s+loaded/.test(stdout)) {
      const active = /Active:\s+active\s+\(([^)]+)\)/.exec(stdout);
      return active ? `${service}: active (${active[1]})` : `${service}: ${stdout.slice(0, 400)}`;
    }
    return `Error: ${stderr || e?.message || "wsl command failed"}`.slice(0, 600);
  }
}