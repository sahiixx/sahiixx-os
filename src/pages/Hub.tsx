import { Link } from "react-router-dom";
import { useModuleCounts } from "@/hooks/useSahiixxData";

// Explicit complete class strings — Tailwind JIT can't generate interpolated
// `text-${color}`, so we look up full classes here. Same pattern as Jarvis Toggle.
const ACCENT: Record<string, { title: string; count: string; border: string }> = {
  "red-primary": { title: "text-red-primary group-hover:text-red-glow", count: "text-red-primary", border: "hover:border-red-primary/40" },
  nexus: { title: "text-nexus group-hover:brightness-125", count: "text-nexus", border: "hover:border-nexus/40" },
  goldmine: { title: "text-goldmine group-hover:brightness-125", count: "text-goldmine", border: "hover:border-goldmine/40" },
  sara: { title: "text-sara group-hover:brightness-125", count: "text-sara", border: "hover:border-sara/40" },
  error: { title: "text-error group-hover:text-red-glow", count: "text-error", border: "hover:border-error/40" },
  gapclaw: { title: "text-gapclaw group-hover:brightness-125", count: "text-gapclaw", border: "hover:border-gapclaw/40" },
};

const modules = [
  { path: "/command-center", name: "COMMAND CENTER", desc: "6-tab operational dashboard", color: "red-primary", countKey: "agents", countLabel: "agents" },
  { path: "/nexus", name: "NEXUS", desc: "Deal engine & pipeline", color: "nexus", countKey: "deals", countLabel: "deals" },
  { path: "/goldmine", name: "GOLDMINE", desc: "CRM & contact intelligence", color: "goldmine", countKey: "contacts", countLabel: "contacts" },
  { path: "/sara", name: "SARA", desc: "Content factory", color: "sara", countKey: "campaigns", countLabel: "campaigns" },
  { path: "/signals", name: "SIGNALS", desc: "Live alert feed", color: "error", countKey: "signals", countLabel: "signals" },
  { path: "/gapclaw", name: "GAPCLAW", desc: "Agent builder", color: "gapclaw", countKey: "deployed", countLabel: "deployed" },
  { path: "/documents", name: "DOCUMENTS", desc: "OCR archive + FTS search", color: "red-primary", countKey: "documents", countLabel: "docs" },
  { path: "/jarvis", name: "JARVIS", desc: "Voice agent + OS control", color: "gapclaw", countKey: "agents", countLabel: "agents" },
  { path: "/status", name: "SYSTEM STATUS", desc: "Readiness, integrations, audit", color: "error", countKey: "mcp", countLabel: "mcp online" },
];

export default function Hub() {
  const counts = useModuleCounts();
  const c = counts.data;

  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <h1 className="font-display text-2xl tracking-widest text-red-primary">MODULE LAUNCHER</h1>
        {c && (
          <span className="font-mono text-xs text-text-muted">
            {c.activeAgents}/{c.agents} agents active · {c.mcp}/{c.mcpTotal} MCP online
            {c.criticalSignals > 0 && <span className="text-error ml-2">· {c.criticalSignals} critical signals</span>}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map((m) => {
          const a = ACCENT[m.color];
          const count = c ? String((c as any)[m.countKey] ?? 0) : "—";
          return (
            <Link key={m.path} to={m.path}
              className={`border border-surface-hover bg-surface p-6 rounded-lg transition-colors group ${a.border}`}>
              <div className="flex items-start justify-between">
                <h2 className={`font-display text-lg tracking-wider ${a.title}`}>{m.name}</h2>
                <span className={`font-mono text-xs ${a.count}`}>{count}</span>
              </div>
              <p className="text-text-secondary text-sm mt-2">{m.desc}</p>
              <div className="font-mono text-[10px] text-text-muted mt-3">{m.countLabel}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}