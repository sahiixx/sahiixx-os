import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useSignalList, useSignalCreate } from "@/hooks/useSahiixxData";
import { trpc } from "@/providers/trpc";

type Severity = "critical" | "high" | "medium" | "low";

const SEVERITY: Record<Severity, { label: string; color: string; border: string; text: string }> = {
  critical: { label: "CRITICAL", color: "#FF1A1A", border: "border-error", text: "text-error" },
  high: { label: "HIGH", color: "#FFAA00", border: "border-warning", text: "text-warning" },
  medium: { label: "MEDIUM", color: "#00CCFF", border: "border-info", text: "text-info" },
  low: { label: "LOW", color: "#00FF66", border: "border-success", text: "text-success" },
};

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

export default function Signals() {
  const utils = trpc.useUtils();
  const signalList = useSignalList();
  const createSignal = useSignalCreate();

  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [message, setMessage] = useState("");
  const [source, setSource] = useState("");

  const signals = signalList.data ?? [];
  const error = signalList.error;

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const s of signals) {
    const sev = (s.severity ?? "low") as Severity;
    if (sev in counts) counts[sev]++;
  }

  const pieData = SEVERITIES.map((sev) => ({ name: SEVERITY[sev].label, value: counts[sev], color: SEVERITY[sev].color }));

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!category.trim() || !message.trim()) return;
    await createSignal.mutateAsync({ category: category.trim(), severity, message: message.trim(), source: source.trim() || undefined });
    utils.sahiixx.signalList.invalidate();
    setCategory("");
    setMessage("");
    setSource("");
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="font-display text-2xl tracking-widest text-error">LIVE SIGNAL FEED</h1>
        <span className="flex items-center gap-1.5 font-mono text-xs text-text-secondary">
          <span className="inline-block w-2 h-2 rounded-full bg-success animate-status-pulse" />
          POLLING 3s
        </span>
      </div>

      {/* severity stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {SEVERITIES.map((sev) => (
          <div key={sev} className={`border ${SEVERITY[sev].border}/40 bg-surface rounded-lg p-4`}>
            <div className={`font-mono text-xs tracking-wider ${SEVERITY[sev].text}`}>{SEVERITY[sev].label}</div>
            <div className="font-display text-3xl text-text-primary mt-1">{counts[sev]}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* distribution + create form */}
        <div className="space-y-6">
          <div className="border border-surface-hover bg-surface rounded-lg p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-2">DISTRIBUTION</h2>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={35} outerRadius={60} paddingAngle={2}>
                    {pieData.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#111", border: "1px solid #222", borderRadius: 4, fontFamily: "JetBrains Mono", fontSize: 11 }}
                    labelStyle={{ color: "#888" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="font-mono text-xs text-text-muted text-center mt-1">{signals.length} total</div>
          </div>

          <form onSubmit={onCreate} className="border border-surface-hover bg-surface rounded-lg p-4 space-y-3">
            <h2 className="font-display text-sm tracking-widest text-text-secondary">INJECT SIGNAL</h2>
            <input
              placeholder="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-error outline-none"
            />
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
              className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-error outline-none"
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{SEVERITY[s].label}</option>
              ))}
            </select>
            <textarea
              placeholder="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-error outline-none resize-none"
            />
            <input
              placeholder="source (optional)"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-error outline-none"
            />
            {createSignal.error && (
              <div className="font-mono text-xs text-error border border-error/40 bg-error/10 rounded px-3 py-2">
                {createSignal.error.message}
              </div>
            )}
            <button
              type="submit"
              disabled={createSignal.isPending || !category.trim() || !message.trim()}
              className="w-full bg-error text-black font-mono text-sm tracking-widest py-2 rounded hover:bg-red-glow transition-colors disabled:opacity-40"
            >
              {createSignal.isPending ? "INJECTING..." : "INJECT"}
            </button>
          </form>
        </div>

        {/* feed */}
        <div className="lg:col-span-2">
          <div className="border border-surface-hover bg-surface rounded-lg p-4 min-h-[300px]">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">FEED</h2>
            {error && (
              <div className="font-mono text-xs text-error border border-error/40 bg-error/10 rounded px-3 py-2 mb-3">
                feed error: {error.message}
              </div>
            )}
            {signals.length === 0 && !error && (
              <div className="font-mono text-xs text-text-muted">no signals</div>
            )}
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {signals.map((s) => {
                  const sev = (s.severity ?? "low") as Severity;
                  const meta = SEVERITY[sev];
                  return (
                    <motion.div
                      key={s.id}
                      layout
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      className={`border-l-2 ${meta.border} bg-void rounded-r px-3 py-2`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-[10px] tracking-wider ${meta.text}`}>{meta.label}</span>
                        <span className="font-mono text-xs text-text-primary">{s.category}</span>
                        {s.source && <span className="font-mono text-[10px] text-text-muted">· {s.source}</span>}
                        <span className="font-mono text-[10px] text-text-muted ml-auto">
                          {s.timestamp ? new Date(s.timestamp).toLocaleTimeString() : ""}
                        </span>
                      </div>
                      <p className="font-mono text-xs text-text-secondary mt-1">{s.message}</p>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}