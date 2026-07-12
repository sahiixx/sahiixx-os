import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useAgentList, useAgentCreate, useAgentDelete, useMcpList, useDeployedList, useDeployedCreate,
} from "@/hooks/useSahiixxData";
import { trpc } from "@/providers/trpc";

type AgentStatus = "online" | "busy" | "error" | "idle";
type McpStatus = "connected" | "warning" | "error" | "disconnected";
type DeployedStatus = "active" | "idle" | "error" | "deploying";

const ASTATUS: Record<AgentStatus, { text: string; dot: string }> = {
  online: { text: "text-success", dot: "bg-success" },
  busy: { text: "text-warning", dot: "bg-warning animate-status-pulse" },
  error: { text: "text-error", dot: "bg-error" },
  idle: { text: "text-text-muted", dot: "bg-text-muted" },
};
const MSTATUS: Record<McpStatus, { text: string; dot: string; label: string }> = {
  connected: { text: "text-success", dot: "bg-success", label: "ONLINE" },
  warning: { text: "text-warning", dot: "bg-warning", label: "WARN" },
  error: { text: "text-error", dot: "bg-error", label: "ERROR" },
  disconnected: { text: "text-text-muted", dot: "bg-text-muted", label: "OFFLINE" },
};
const DSTATUS: Record<DeployedStatus, { text: string; dot: string; label: string }> = {
  active: { text: "text-success", dot: "bg-success animate-status-pulse", label: "ACTIVE" },
  idle: { text: "text-text-muted", dot: "bg-text-muted", label: "IDLE" },
  error: { text: "text-error", dot: "bg-error", label: "ERROR" },
  deploying: { text: "text-info", dot: "bg-info animate-status-pulse", label: "DEPLOYING" },
};

const AGENT_TYPES = ["code", "review", "test", "deploy", "lint", "docs", "lead-scanner", "followup-bot", "compliance-watch", "sentiment-crawler"];

export default function GapClaw() {
  const utils = trpc.useUtils();
  const agentList = useAgentList();
  const createAgent = useAgentCreate();
  const deleteAgent = useAgentDelete();
  const mcpList = useMcpList();
  const deployedList = useDeployedList();
  const createDeployed = useDeployedCreate();

  const agents = agentList.data ?? [];
  const mcp = mcpList.data ?? [];
  const deployed = deployedList.data ?? [];

  const [aForm, setAForm] = useState({ name: "", type: "code", model: "sonnet-4.6", task: "", status: "idle" as AgentStatus });
  const [dForm, setDForm] = useState({ name: "", template: "lead-scanner", target: "" });

  async function onCreateA(e: React.FormEvent) {
    e.preventDefault();
    if (!aForm.name.trim()) return;
    await createAgent.mutateAsync({ name: aForm.name.trim(), type: aForm.type, model: aForm.model, task: aForm.task.trim() || undefined, status: aForm.status });
    utils.sahiixx.agentList.invalidate();
    setAForm({ name: "", type: "code", model: "sonnet-4.6", task: "", status: "idle" });
  }
  async function onCreateD(e: React.FormEvent) {
    e.preventDefault();
    if (!dForm.name.trim() || !dForm.target.trim()) return;
    await createDeployed.mutateAsync({ name: dForm.name.trim(), template: dForm.template, target: dForm.target.trim() });
    utils.sahiixx.deployedList.invalidate();
    setDForm({ name: "", template: "lead-scanner", target: "" });
  }
  async function onDelete(id: number) {
    await deleteAgent.mutateAsync({ id });
    utils.sahiixx.agentList.invalidate();
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="font-display text-2xl tracking-widest text-gapclaw">GAPCLAW AGENT BUILDER</h1>
        <span className="font-mono text-xs text-text-muted">agents · MCP · deployments</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Tile label="AGENTS" value={String(agents.length)} accent="text-gapclaw" />
        <Tile label="ACTIVE" value={String(agents.filter((a) => a.status === "busy" || a.status === "online").length)} accent="text-success" />
        <Tile label="MCP ONLINE" value={`${mcp.filter((m) => m.status === "connected").length}/${mcp.length}`} accent="text-info" />
        <Tile label="DEPLOYED" value={String(deployed.length)} accent="text-warning" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div className="border border-surface-hover bg-surface rounded-lg p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">AGENT REGISTRY</h2>
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {agents.map((a) => {
                  const st = (a.status ?? "idle") as AgentStatus;
                  const meta = ASTATUS[st];
                  return (
                    <motion.div key={a.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                      className="border border-surface-hover bg-void rounded px-3 py-2 flex items-center gap-3">
                      <span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-sm text-text-primary truncate">{a.name}</div>
                        <div className="font-mono text-[10px] text-text-muted">{a.type} · {a.model}</div>
                      </div>
                      <span className={`font-mono text-[10px] tracking-wider ${meta.text} uppercase`}>{st}</span>
                      <button onClick={() => onDelete(a.id)}
                        className="font-mono text-[10px] text-text-muted hover:text-error border border-surface-hover hover:border-error/40 rounded px-1.5 py-0.5">
                        DEL
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {agents.length === 0 && <div className="font-mono text-xs text-text-muted">no agents — create one below</div>}
            </div>
          </div>

          <div className="border border-surface-hover bg-surface rounded-lg p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">DEPLOYED AGENTS</h2>
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {deployed.map((d) => {
                  const st = (d.status ?? "idle") as DeployedStatus;
                  const meta = DSTATUS[st];
                  return (
                    <motion.div key={d.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                      className="border border-surface-hover bg-void rounded px-3 py-2 flex items-center gap-3">
                      <span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-sm text-text-primary truncate">{d.name}</div>
                        <div className="font-mono text-[10px] text-text-muted">{d.template} → {d.target ?? "—"} · last run {d.lastRun ? new Date(d.lastRun).toLocaleTimeString() : "never"}</div>
                      </div>
                      <span className={`font-mono text-[10px] tracking-wider ${meta.text}`}>{meta.label}</span>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {deployed.length === 0 && <div className="font-mono text-xs text-text-muted">no deployments</div>}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <form onSubmit={onCreateA} className="border border-surface-hover bg-surface rounded-lg p-4 space-y-3">
            <h2 className="font-display text-sm tracking-widest text-text-secondary">NEW AGENT</h2>
            <input placeholder="agent name" value={aForm.name} onChange={(e) => setAForm({ ...aForm, name: e.target.value })}
              className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-gapclaw outline-none" />
            <select value={aForm.type} onChange={(e) => setAForm({ ...aForm, type: e.target.value })}
              className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-gapclaw outline-none">
              {AGENT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <input placeholder="model" value={aForm.model} onChange={(e) => setAForm({ ...aForm, model: e.target.value })}
              className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-gapclaw outline-none" />
            <input placeholder="task (optional)" value={aForm.task} onChange={(e) => setAForm({ ...aForm, task: e.target.value })}
              className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-gapclaw outline-none" />
            <select value={aForm.status} onChange={(e) => setAForm({ ...aForm, status: e.target.value as AgentStatus })}
              className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-gapclaw outline-none">
              {(Object.keys(ASTATUS) as AgentStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="submit" disabled={createAgent.isPending || !aForm.name.trim()}
              className="w-full bg-gapclaw text-black font-mono text-sm tracking-widest py-2 rounded hover:brightness-110 transition disabled:opacity-40">
              {createAgent.isPending ? "DEPLOYING..." : "DEPLOY AGENT"}
            </button>
          </form>

          <form onSubmit={onCreateD} className="border border-surface-hover bg-surface rounded-lg p-4 space-y-3">
            <h2 className="font-display text-sm tracking-widest text-text-secondary">DEPLOY TO TARGET</h2>
            <input placeholder="deployment name" value={dForm.name} onChange={(e) => setDForm({ ...dForm, name: e.target.value })}
              className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-gapclaw outline-none" />
            <select value={dForm.template} onChange={(e) => setDForm({ ...dForm, template: e.target.value })}
              className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-gapclaw outline-none">
              {["lead-scanner", "followup-bot", "compliance-watch", "sentiment-crawler"].map((t) => <option key={t}>{t}</option>)}
            </select>
            <input placeholder="target (e.g. DLD + Bayut)" value={dForm.target} onChange={(e) => setDForm({ ...dForm, target: e.target.value })}
              className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-gapclaw outline-none" />
            <button type="submit" disabled={createDeployed.isPending || !dForm.name.trim() || !dForm.target.trim()}
              className="w-full bg-gapclaw/80 text-black font-mono text-sm tracking-widest py-2 rounded hover:bg-gapclaw transition disabled:opacity-40">
              {createDeployed.isPending ? "DEPLOYING..." : "LAUNCH"}
            </button>
          </form>

          <div className="border border-surface-hover bg-surface rounded-lg p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">MCP SERVERS</h2>
            <div className="space-y-2">
              {mcp.map((m) => {
                const st = (m.status ?? "disconnected") as McpStatus;
                const meta = MSTATUS[st];
                return (
                  <div key={m.id} className="flex items-center gap-2 font-mono text-xs">
                    <span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} />
                    <span className="text-text-primary truncate">{m.name}</span>
                    <span className="text-text-muted text-[10px]">{m.latency}ms</span>
                    <span className={`text-[10px] tracking-wider ${meta.text} ml-auto`}>{meta.label}</span>
                  </div>
                );
              })}
              {mcp.length === 0 && <div className="font-mono text-xs text-text-muted">no MCP servers</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="border border-surface-hover bg-surface rounded-lg p-4">
      <div className={`font-mono text-xs tracking-wider ${accent}`}>{label}</div>
      <div className="font-display text-2xl text-text-primary mt-1">{value}</div>
    </div>
  );
}