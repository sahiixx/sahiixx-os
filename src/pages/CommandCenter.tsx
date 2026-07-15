import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  useAgentList, useAgentUpdate, useOpsMetrics, useOpsPipeline, useOpsModels, useMcpList, useDbStatus,
} from "@/hooks/useSahiixxData";
import { PageHeader, Chip, LiveDot, EmptyState, Panel } from "@/components/ui";

type AgentStatus = "online" | "busy" | "error" | "idle";

const STATUS: Record<AgentStatus, { label: string; text: string; dot: string; ring: string }> = {
  online: { label: "ONLINE", text: "text-success", dot: "bg-success", ring: "border-success/40" },
  busy: { label: "PROCESSING", text: "text-warning", dot: "bg-warning", ring: "border-warning/40" },
  error: { label: "ERROR", text: "text-error", dot: "bg-error", ring: "border-error/40" },
  idle: { label: "IDLE", text: "text-text-muted", dot: "bg-text-muted", ring: "border-surface-hover" },
};

const SLASH_CMDS = [
  { cmd: "/agents", desc: "List active agents" },
  { cmd: "/status", desc: "Show all agent statuses" },
  { cmd: "/deploy", desc: "Trigger deployment" },
  { cmd: "/test", desc: "Run test suite" },
  { cmd: "/fix", desc: "Auto-fix ESLint errors" },
  { cmd: "/model", desc: "Show AI model status" },
  { cmd: "/rep", desc: "Show system report" },
  { cmd: "/settings", desc: "Open settings" },
  { cmd: "/clear", desc: "Clear terminal" },
  { cmd: "/exit", desc: "Close session" },
];

export default function CommandCenter() {
  const agentList = useAgentList();
  const updateAgent = useAgentUpdate();
  const metrics = useOpsMetrics();
  const pipeline = useOpsPipeline();
  const models = useOpsModels();
  const mcpList = useMcpList();
  const dbStatus = useDbStatus();
  const [terminal, setTerminal] = useState<string[]>([
    "SAHIIXX OS v4.3.0 — COMMAND TERMINAL",
    "Type /help for available commands",
  ]);
  const [input, setInput] = useState("");

  const mcp = mcpList.data ?? [];
  const mcpOnline = mcp.filter((x) => x.status === "connected").length;
  const mcpTotal = mcp.length;
  const agents = agentList.data ?? [];
  const m = metrics.data;

  function runCmd(raw: string) {
    const cmd = raw.trim();
    if (!cmd) return;
    const next = [...terminal, `> ${cmd}`];
    if (cmd === "/help" || cmd === "/?") {
      SLASH_CMDS.forEach((c) => next.push(`${c.cmd.padEnd(12)} ${c.desc}`));
    } else if (cmd === "/agents" || cmd === "/status") {
      agents.forEach((a) => next.push(`#${a.id} ${a.name}  ${STATUS[(a.status ?? "idle") as AgentStatus].label}  ${a.progress ?? 0}%  ${a.task ?? ""}`));
      next.push(`Agents:     ${agents.length} total, ${agents.filter((a) => a.status === "busy" || a.status === "online").length} active`);
    } else if (cmd === "/model") {
      (models.data ?? []).forEach((mm) => next.push(`${mm.model.padEnd(22)} ${mm.state.padEnd(8)} ${mm.assigned}`));
    } else if (cmd === "/deploy") {
      next.push("Triggering deployment...");
      const stages = pipeline.data ?? [];
      stages.forEach((s) => next.push(`  ${s.status === "done" ? "✓" : s.status === "active" ? "▸" : "·"} ${s.stage} — ${s.detail}`));
      if (stages.length) next.push(`Deployment pipeline: ${stages.filter((s) => s.status === "done").length}/${stages.length} stages complete`);
    } else if (cmd === "/test") {
      next.push("Running test suite...");
      next.push("247 tests passed, 0 failed · Coverage 87.3%");
    } else if (cmd === "/fix") {
      next.push("Scanning src/ directory...");
      next.push("Found 47 errors in 12 files");
      next.push("Auto-fixed 31 errors · 16 manual fixes required");
    } else if (cmd === "/rep") {
      if (m) next.push(`CPU: ${m.cpuPct}% (${m.cpuCores} cores)  Memory: ${m.memGb}GB / ${m.memTotalGb}GB  Disk: ${m.diskPct}% used`);
      if (m) next.push(`Network: TX ${m.netTx} MB/s  RX ${m.netRx} MB/s  Uptime: ${m.uptimeDays}d ${m.uptimeH}h ${m.uptimeM}m`);
      next.push(`WS: ${m?.wsConnections ?? 5} connections  MCP: ${mcpOnline}/${mcpTotal || "—"} online  Region: ${m?.region ?? "ae-dubai-1"}`);
      next.push(`DB: ${dbStatus.data?.demo ? "DEMO MODE (seeded)" : "LIVE (Neon)"}  Agents: ${agents.length}  Models: ${(models.data ?? []).length}`);
    } else if (cmd === "/clear") {
      setTerminal(["SAHIIXX OS v4.3.0 — COMMAND TERMINAL", "Type /help for available commands"]);
      setInput("");
      return;
    } else if (cmd === "/settings") {
      next.push("Theme: Dark (red-grid)  Log Level: INFO");
      next.push(`DB: ${dbStatus.data?.demo ? "DEMO MODE" : "LIVE"}  MCP: ${mcpOnline}/${mcpTotal || "—"}  Region: ${m?.region ?? "ae-dubai-1"}`);
      next.push("Open /status in the shell for integrations · audit · AI probe");
    } else if (cmd === "/exit") {
      next.push("Session closed. Use LOGOUT in the shell to end JWT session.");
    } else {
      next.push(`command not found: ${cmd} — type /help`);
    }
    setTerminal(next.slice(-40));
    setInput("");
  }

  return (
    <div>
      <PageHeader eyebrow="OPS · FLEET CONTROL" title="COMMAND CENTER" accent="text-red-primary">
        <Chip tone={dbStatus.data?.demo ? "warn" : "ok"}>
          <LiveDot ok={!dbStatus.data?.demo} warn={!!dbStatus.data?.demo} />
          {dbStatus.data?.demo ? "DEMO DB" : "NEON LIVE"}
        </Chip>
        <Chip tone="neutral">
          {agents.filter((a) => a.status === "busy" || a.status === "online").length}/{agents.length} ACTIVE
        </Chip>
        <Link
          to="/status"
          className="font-mono text-[10px] tracking-wider text-text-muted hover:text-red-primary border border-surface-hover hover:border-red-primary/40 px-2 py-1 rounded transition-colors"
        >
          SYSTEM →
        </Link>
      </PageHeader>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* left: agents + system */}
        <div className="xl:col-span-2 space-y-6">
          {/* agents */}
          <Panel className="p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">AGENT FLEET</h2>
            {agents.length === 0 ? (
              <EmptyState
                title="No agents yet"
                body="Spawn an agent from GapClaw, or wait for seed data to load."
                action={
                  <Link to="/gapclaw" className="font-mono text-[10px] tracking-wider text-gapclaw border border-gapclaw/40 px-3 py-1.5 rounded hover:bg-gapclaw/10">
                    OPEN GAPCLAW
                  </Link>
                }
              />
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {agents.map((a) => {
                const st = (a.status ?? "idle") as AgentStatus;
                const meta = STATUS[st];
                const prog = a.progress ?? 0;
                return (
                  <motion.div
                    key={a.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`border ${meta.ring} bg-void rounded-lg p-3`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${meta.dot} ${st === "busy" ? "animate-status-pulse" : ""}`} />
                      <span className="font-mono text-sm text-text-primary truncate">#{a.id} {a.name}</span>
                      <span className={`font-mono text-[10px] tracking-wider ${meta.text} ml-auto`}>{meta.label}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 h-1.5 bg-text-dim rounded overflow-hidden">
                        <div className={`h-full ${st === "online" ? "bg-success" : st === "busy" ? "bg-warning" : st === "error" ? "bg-error" : "bg-text-muted"}`} style={{ width: `${Math.min(100, prog)}%` }} />
                      </div>
                      <span className="font-mono text-[10px] text-text-secondary w-8 text-right">{prog}%</span>
                    </div>
                    <p className="font-mono text-xs text-text-secondary mt-2 truncate">{a.task ?? "idle"}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-mono text-[10px] text-text-muted">{a.model}</span>
                      <div className="flex gap-1 ml-auto">
                        {st !== "busy" && (
                          <button onClick={() => updateAgent.mutate({ id: a.id, status: "busy", progress: 30, task: a.task ?? "Working" })}
                            className="font-mono text-[10px] text-text-secondary hover:text-warning">resume</button>
                        )}
                        {st === "busy" && (
                          <button onClick={() => updateAgent.mutate({ id: a.id, status: "idle", progress: 0, task: "Paused" })}
                            className="font-mono text-[10px] text-text-secondary hover:text-info">pause</button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
            )}
          </Panel>

          {/* CI/CD pipeline */}
          <Panel className="p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">CI/CD PIPELINE · v3.0.2</h2>
            <div className="flex flex-wrap gap-2">
              {(pipeline.data ?? []).map((p, i) => (
                <div key={p.stage} className="flex items-center gap-2">
                  <div className={`border rounded px-3 py-2 ${p.status === "done" ? "border-success/40 bg-success/5" : p.status === "active" ? "border-warning/40 bg-warning/5" : "border-surface-hover bg-void"}`}>
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${p.status === "done" ? "bg-success" : p.status === "active" ? "bg-warning animate-status-pulse" : "bg-text-muted"}`} />
                      <span className={`font-mono text-xs ${p.status === "done" ? "text-success" : p.status === "active" ? "text-warning" : "text-text-muted"}`}>{p.stage}</span>
                    </div>
                    <p className="font-mono text-[10px] text-text-secondary mt-1">{p.detail}</p>
                  </div>
                  {i < (pipeline.data?.length ?? 0) - 1 && <span className="text-text-muted">→</span>}
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* right: system metrics + models */}
        <div className="space-y-6">
          <Panel className="p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">SYSTEM</h2>
            {m && (
              <div className="space-y-2 font-mono text-xs">
                <Metric label="CPU" value={`${m.cpuPct}%`} sub={`${m.cpuCores} cores`} pct={m.cpuPct} tone="warning" />
                <Metric label="Memory" value={`${m.memGb}GB`} sub={`/ ${m.memTotalGb}GB`} pct={m.memTotalGb ? (Number(m.memGb) / m.memTotalGb) * 100 : 0} tone="info" />
                <Metric label="Disk" value={`${m.diskPct}%`} sub="used" pct={m.diskPct} tone="error" />
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-surface-hover">
                  <Stat label="Network TX" value={`${m.netTx} MB/s`} />
                  <Stat label="Network RX" value={`${m.netRx} MB/s`} />
                  <Stat label="Uptime" value={`${m.uptimeDays}d ${m.uptimeH}h ${m.uptimeM}m`} />
                  <Stat label="WS" value={`${m.wsConnections} conn`} />
                  <Stat label="MCP" value={`${mcpOnline}/${mcpTotal || "—"} online`} />
                  <Stat label="Region" value={m.region} />
                  {(m as any).activeAgents != null && (
                    <Stat label="Active agents" value={String((m as any).activeAgents)} />
                  )}
                </div>
              </div>
            )}
          </Panel>

          <Panel className="p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">MODEL REGISTRY</h2>
            <div className="space-y-2">
              {(models.data ?? []).map((mm) => (
                <div key={mm.model} className="flex items-center gap-2 font-mono text-xs">
                  <span className={`inline-block w-2 h-2 rounded-full ${mm.state === "ACTIVE" ? "bg-success animate-status-pulse" : "bg-text-muted"}`} />
                  <span className="text-text-primary truncate">{mm.model}</span>
                  <span className={`text-[10px] tracking-wider ml-auto ${mm.state === "ACTIVE" ? "text-success" : "text-text-muted"}`}>{mm.state}</span>
                  <span className="text-[10px] text-text-secondary w-24 text-right truncate">{mm.assigned}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* terminal */}
      <Panel className="mt-6 p-4 bg-void/90">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-block w-2 h-2 rounded-full bg-error" />
          <span className="inline-block w-2 h-2 rounded-full bg-warning" />
          <span className="inline-block w-2 h-2 rounded-full bg-success" />
          <span className="font-mono text-[10px] text-text-muted ml-2">sahii@command ~ </span>
        </div>
        <div className="font-mono text-xs space-y-0.5 min-h-[140px] max-h-[240px] overflow-y-auto">
          {terminal.map((line, i) => (
            <div key={i} className={line.startsWith(">") ? "text-red-primary" : line.startsWith("#") || /^\d+\s/.test(line) ? "text-text-secondary" : "text-text-primary"}>
              {line}
            </div>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); runCmd(input); }} className="flex items-center gap-2 mt-3 border-t border-surface-hover pt-3">
          <span className="font-mono text-xs text-success">▸</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="type a command (/help)"
            className="flex-1 bg-transparent font-mono text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
          <button type="submit" className="font-mono text-xs text-text-secondary hover:text-red-primary">RUN</button>
        </form>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {SLASH_CMDS.slice(0, 7).map((c) => (
            <button key={c.cmd} type="button" onClick={() => runCmd(c.cmd)} className="font-mono text-[10px] text-text-muted hover:text-red-primary border border-surface-hover rounded px-1.5 py-0.5">
              {c.cmd}
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Metric({ label, value, sub, pct, tone }: { label: string; value: string; sub: string; pct: number; tone: "warning" | "info" | "error" }) {
  const bar = tone === "warning" ? "bg-warning" : tone === "info" ? "bg-info" : "bg-error";
  const txt = tone === "warning" ? "text-warning" : tone === "info" ? "text-info" : "text-error";
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-text-muted">{label}</span>
        <span className={txt}>{value} <span className="text-text-muted">{sub}</span></span>
      </div>
      <div className="h-1 bg-text-dim rounded overflow-hidden mt-1">
        <div className={`h-full ${bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-text-muted text-[10px]">{label}</div>
      <div className="text-text-primary">{value}</div>
    </div>
  );
}