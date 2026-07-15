import { Link } from "react-router-dom";
import { useModuleCounts } from "@/hooks/useSahiixxData";
import { useSystemStatus } from "@/hooks/useSystemData";
import { PageHeader, Panel, Chip, LiveDot, Skeleton } from "@/components/ui";

const ACCENT: Record<
  string,
  { title: string; count: string; border: string; glow: string; bar: string }
> = {
  "red-primary": {
    title: "text-red-primary group-hover:text-red-glow",
    count: "text-red-primary",
    border: "hover:border-red-primary/50",
    glow: "group-hover:shadow-[0_0_24px_-8px_rgba(255,26,26,0.45)]",
    bar: "bg-red-primary",
  },
  nexus: {
    title: "text-nexus group-hover:brightness-125",
    count: "text-nexus",
    border: "hover:border-nexus/50",
    glow: "group-hover:shadow-[0_0_24px_-8px_rgba(255,149,0,0.4)]",
    bar: "bg-nexus",
  },
  goldmine: {
    title: "text-goldmine group-hover:brightness-125",
    count: "text-goldmine",
    border: "hover:border-goldmine/50",
    glow: "group-hover:shadow-[0_0_24px_-8px_rgba(0,136,255,0.4)]",
    bar: "bg-goldmine",
  },
  sara: {
    title: "text-sara group-hover:brightness-125",
    count: "text-sara",
    border: "hover:border-sara/50",
    glow: "group-hover:shadow-[0_0_24px_-8px_rgba(0,221,119,0.35)]",
    bar: "bg-sara",
  },
  error: {
    title: "text-error group-hover:text-red-glow",
    count: "text-error",
    border: "hover:border-error/50",
    glow: "group-hover:shadow-[0_0_24px_-8px_rgba(255,26,26,0.35)]",
    bar: "bg-error",
  },
  gapclaw: {
    title: "text-gapclaw group-hover:brightness-125",
    count: "text-gapclaw",
    border: "hover:border-gapclaw/50",
    glow: "group-hover:shadow-[0_0_24px_-8px_rgba(0,204,255,0.35)]",
    bar: "bg-gapclaw",
  },
  documents: {
    title: "text-documents group-hover:brightness-125",
    count: "text-documents",
    border: "hover:border-documents/50",
    glow: "group-hover:shadow-[0_0_24px_-8px_rgba(167,139,250,0.35)]",
    bar: "bg-documents",
  },
};

const modules = [
  {
    path: "/command-center",
    name: "COMMAND CENTER",
    desc: "Live ops dashboard — agents, pipeline, models",
    color: "red-primary",
    countKey: "agents",
    countLabel: "agents",
    tag: "01",
  },
  {
    path: "/nexus",
    name: "NEXUS",
    desc: "Deal engine + live estate leads bridge",
    color: "nexus",
    countKey: "deals",
    countLabel: "deals",
    tag: "02",
  },
  {
    path: "/goldmine",
    name: "GOLDMINE",
    desc: "CRM & contact intelligence",
    color: "goldmine",
    countKey: "contacts",
    countLabel: "contacts",
    tag: "03",
  },
  {
    path: "/sara",
    name: "SARA",
    desc: "Content factory & campaigns",
    color: "sara",
    countKey: "campaigns",
    countLabel: "campaigns",
    tag: "04",
  },
  {
    path: "/signals",
    name: "SIGNALS",
    desc: "Alert feed — critical path first",
    color: "error",
    countKey: "signals",
    countLabel: "signals",
    tag: "05",
  },
  {
    path: "/gapclaw",
    name: "GAPCLAW",
    desc: "Agent builder & deployments",
    color: "gapclaw",
    countKey: "deployed",
    countLabel: "deployed",
    tag: "06",
  },
  {
    path: "/documents",
    name: "DOCUMENTS",
    desc: "OCR archive + full-text search",
    color: "documents",
    countKey: "documents",
    countLabel: "docs",
    tag: "07",
  },
  {
    path: "/jarvis",
    name: "JARVIS",
    desc: "Voice agent · Ollama Cloud · tools",
    color: "gapclaw",
    countKey: "agents",
    countLabel: "agents",
    tag: "08",
  },
  {
    path: "/status",
    name: "SYSTEM STATUS",
    desc: "Readiness · integrations · audit",
    color: "error",
    countKey: "mcp",
    countLabel: "mcp online",
    tag: "09",
  },
];

export default function Hub() {
  const counts = useModuleCounts();
  const sys = useSystemStatus();
  const c = counts.data;
  const loading = counts.isLoading && !c;
  const d = sys.data;

  return (
    <div>
      <PageHeader
        eyebrow="SAHIIXX OS · MODULE LAUNCHER"
        title="COMMAND DECK"
        accent="text-red-primary"
      >
        {c?.source === "db" ? (
          <Chip tone="ok">
            <LiveDot ok />
            NEON LIVE
          </Chip>
        ) : c ? (
          <Chip tone="warn">DEMO COUNTS</Chip>
        ) : null}
        {d?.integrations?.jarvis?.provider && (
          <Chip tone="info">
            LLM {d.integrations.jarvis.provider.toUpperCase()}
            {d.integrations.jarvis.model ? ` · ${d.integrations.jarvis.model}` : ""}
          </Chip>
        )}
      </PageHeader>

      {/* Mission strip */}
      <Panel className="px-4 py-3 mb-6 sm:mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 font-mono text-[11px]">
          {loading ? (
            <>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-28" />
            </>
          ) : (
            <>
              <span className="text-text-secondary">
                <span className="text-red-primary">{c?.activeAgents ?? "—"}</span>
                <span className="text-text-muted"> / {c?.agents ?? "—"} agents active</span>
              </span>
              <span className="hidden sm:inline text-text-dim">│</span>
              <span className="text-text-secondary">
                <span className="text-nexus">{c?.deals ?? "—"}</span>
                <span className="text-text-muted"> deals</span>
              </span>
              <span className="hidden sm:inline text-text-dim">│</span>
              <span className="text-text-secondary">
                <span className="text-goldmine">{c?.contacts ?? "—"}</span>
                <span className="text-text-muted"> contacts</span>
              </span>
              {c && c.criticalSignals > 0 && (
                <>
                  <span className="hidden sm:inline text-text-dim">│</span>
                  <span className="text-error flex items-center gap-1.5">
                    <LiveDot ok={false} />
                    {c.criticalSignals} critical
                  </span>
                </>
              )}
              <span className="sm:ml-auto text-text-muted tracking-wider">
                {c?.mcp ?? 0}/{c?.mcpTotal ?? 0} MCP ONLINE
              </span>
            </>
          )}
        </div>
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
        {loading
          ? Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-lg" />
            ))
          : modules.map((m, i) => {
              const a = ACCENT[m.color] ?? ACCENT["red-primary"];
              const count = c ? String((c as any)[m.countKey] ?? 0) : "—";
              return (
                <Link
                  key={m.path}
                  to={m.path}
                  style={{ animationDelay: `${i * 40}ms` }}
                  className={`group relative border border-surface-hover bg-surface p-5 rounded-lg transition-all duration-200 overflow-hidden animate-fade-up ${a.border} ${a.glow}`}
                >
                  <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${a.bar} opacity-70`} />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] text-text-muted tracking-[0.3em] mb-1">
                        {m.tag}
                      </div>
                      <h2
                        className={`font-display text-base sm:text-lg tracking-wider ${a.title}`}
                      >
                        {m.name}
                      </h2>
                    </div>
                    <span
                      className={`font-mono text-lg tabular-nums ${a.count} shrink-0`}
                    >
                      {count}
                    </span>
                  </div>
                  <p className="text-text-secondary text-sm mt-2 leading-snug">{m.desc}</p>
                  <div className="flex items-center justify-between mt-4">
                    <span className="font-mono text-[10px] text-text-muted tracking-wider uppercase">
                      {m.countLabel}
                    </span>
                    <span className="font-mono text-[10px] text-text-muted group-hover:text-text-secondary transition-colors tracking-widest">
                      ENTER →
                    </span>
                  </div>
                </Link>
              );
            })}
      </div>
    </div>
  );
}
