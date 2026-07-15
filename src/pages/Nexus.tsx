import { useState } from "react";
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell, Tooltip } from "recharts";
import { useDealList, useDealCreate } from "@/hooks/useSahiixxData";
import { useEstateConfig, useEstateHealth, useEstateLeads, useImportLeadAsDeal } from "@/hooks/useSystemData";
import { trpc } from "@/providers/trpc";

type Tier = "HARD" | "MEDIUM" | "LOW" | "CLOSED";

const TIER: Record<Tier, { label: string; color: string; text: string; border: string }> = {
  HARD: { label: "HARD", color: "#FF1A1A", text: "text-error", border: "border-error/40" },
  MEDIUM: { label: "MEDIUM", color: "#FFAA00", text: "text-warning", border: "border-warning/40" },
  LOW: { label: "LOW", color: "#00CCFF", text: "text-info", border: "border-info/40" },
  CLOSED: { label: "CLOSED", color: "#555555", text: "text-text-muted", border: "border-text-muted/40" },
};

const TIERS: Tier[] = ["HARD", "MEDIUM", "LOW", "CLOSED"];

function fmtAed(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M AED`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K AED`;
  return `${n} AED`;
}

export default function Nexus() {
  const utils = trpc.useUtils();
  const dealList = useDealList();
  const dealCreate = useDealCreate();
  const estateCfg = useEstateConfig();
  const estateHealth = useEstateHealth();
  const estateLeads = useEstateLeads();
  const importLead = useImportLeadAsDeal();

  const deals = dealList.data ?? [];
  const liveLeads = estateLeads.data?.leads ?? [];
  const liveOk = estateHealth.data?.ok ?? false;

  const counts: Record<Tier, number> = { HARD: 0, MEDIUM: 0, LOW: 0, CLOSED: 0 };
  let totalValue = 0;
  let scoreSum = 0;
  let activeCount = 0;
  for (const d of deals) {
    const t = (d.tier ?? "LOW") as Tier;
    if (t in counts) counts[t]++;
    totalValue += Number(d.priceAed ?? 0);
    scoreSum += Number(d.score ?? 0);
    if (d.status === "active") activeCount++;
  }
  const avgScore = deals.length ? Math.round(scoreSum / deals.length) : 0;

  const tierData = TIERS.map((t) => ({ name: TIER[t].label, value: counts[t], color: TIER[t].color }));

  const [form, setForm] = useState({
    dealId: "", property: "", type: "", area: "",
    priceAed: "", score: "", tier: "MEDIUM" as Tier, commission: "",
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.dealId.trim() || !form.property.trim() || !form.priceAed) return;
    await dealCreate.mutateAsync({
      dealId: form.dealId.trim(),
      property: form.property.trim(),
      type: form.type.trim() || undefined,
      area: form.area.trim() || undefined,
      priceAed: Number(form.priceAed),
      score: form.score ? Number(form.score) : undefined,
      tier: form.tier,
      commission: form.commission ? Number(form.commission) : undefined,
    });
    utils.sahiixx.dealList.invalidate();
    setForm({ dealId: "", property: "", type: "", area: "", priceAed: "", score: "", tier: "MEDIUM", commission: "" });
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <div className="font-mono text-[10px] tracking-[0.35em] text-text-muted mb-1.5">DEAL PIPELINE</div>
          <h1 className="font-display text-xl sm:text-2xl tracking-widest text-nexus">NEXUS DEAL ENGINE</h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider px-2.5 py-1 rounded border ${
              liveOk
                ? "border-success/40 text-success bg-success/5"
                : "border-surface-hover text-text-muted bg-void"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${liveOk ? "bg-success animate-pulse" : "bg-text-muted"}`} />
            ESTATE {liveOk ? "ONLINE" : estateCfg.data?.configured ? "DOWN" : "UNCONFIGURED"}
            {estateHealth.data?.latencyMs != null && liveOk ? ` · ${estateHealth.data.latencyMs}ms` : ""}
          </span>
        </div>
      </div>

      {/* summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Tile label="TOTAL DEALS" value={String(deals.length)} accent="text-nexus" />
        <Tile label="TOTAL VALUE" value={fmtAed(totalValue)} accent="text-success" />
        <Tile label="AVG SCORE" value={String(avgScore)} accent="text-warning" />
        <Tile label="ACTIVE" value={String(activeCount)} accent="text-info" />
      </div>

      {/* Live estate leads bridge */}
      <div className="border border-nexus/30 bg-surface rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="font-display text-sm tracking-widest text-nexus">LIVE ESTATE LEADS</h2>
          <span className="font-mono text-[10px] text-text-muted truncate max-w-[50%]">
            {estateCfg.data?.baseUrl ?? "set ESTATE_API_URL"}
          </span>
        </div>
        {!estateCfg.data?.configured && (
          <p className="font-mono text-xs text-text-muted mb-2">
            Bridge offline on edge. Local Vite uses http://127.0.0.1:3001. For prod, tunnel WSL estate-api and set Pages secret ESTATE_API_URL.
          </p>
        )}
        {estateLeads.data?.error && (
          <div className="font-mono text-xs text-warning border border-warning/30 bg-warning/10 rounded px-3 py-2 mb-2">
            {estateLeads.data.error}
          </div>
        )}
        {liveLeads.length === 0 && !estateLeads.data?.error && (
          <div className="font-mono text-xs text-text-muted">no live leads</div>
        )}
        <div className="space-y-2 max-h-56 overflow-y-auto">
          {liveLeads.map((l) => (
            <div key={l.id} className="flex items-center gap-2 border border-surface-hover bg-void rounded px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm text-text-primary truncate">{l.name}</div>
                <div className="font-mono text-[10px] text-text-muted truncate">
                  {[l.phone, l.email, l.status, l.property_title].filter(Boolean).join(" · ")}
                </div>
              </div>
              <button
                type="button"
                disabled={importLead.isPending}
                onClick={async () => {
                  await importLead.mutateAsync({ leadId: l.id, tier: "MEDIUM" });
                }}
                className="font-mono text-[10px] tracking-wider px-2 py-1 rounded border border-nexus/40 text-nexus hover:bg-nexus/10 shrink-0"
              >
                IMPORT → DEAL
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* pipeline + create */}
        <div className="space-y-6">
          <div className="border border-surface-hover bg-surface rounded-lg p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-2">PIPELINE BY TIER</h2>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tierData}>
                  <XAxis dataKey="name" tick={{ fill: "#888", fontFamily: "JetBrains Mono", fontSize: 10 }} axisLine={{ stroke: "#222" }} tickLine={false} />
                  <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                    {tierData.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Bar>
                  <Tooltip
                    cursor={{ fill: "#22222255" }}
                    contentStyle={{ background: "#111", border: "1px solid #222", borderRadius: 4, fontFamily: "JetBrains Mono", fontSize: 11 }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <form onSubmit={onCreate} className="border border-surface-hover bg-surface rounded-lg p-4 space-y-3">
            <h2 className="font-display text-sm tracking-widest text-text-secondary">NEW DEAL</h2>
            <div className="grid grid-cols-2 gap-2">
              <Field placeholder="deal id" value={form.dealId} onChange={(v) => set("dealId", v)} />
              <Field placeholder="property" value={form.property} onChange={(v) => set("property", v)} />
              <Field placeholder="type" value={form.type} onChange={(v) => set("type", v)} />
              <Field placeholder="area" value={form.area} onChange={(v) => set("area", v)} />
              <Field placeholder="price (AED)" value={form.priceAed} onChange={(v) => set("priceAed", v)} type="number" />
              <Field placeholder="score" value={form.score} onChange={(v) => set("score", v)} type="number" />
              <Field placeholder="commission" value={form.commission} onChange={(v) => set("commission", v)} type="number" />
              <select
                value={form.tier}
                onChange={(e) => set("tier", e.target.value)}
                className="bg-void border border-surface-hover rounded px-2 py-2 font-mono text-sm text-text-primary focus:border-nexus outline-none"
              >
                {TIERS.map((t) => (
                  <option key={t} value={t}>{TIER[t].label}</option>
                ))}
              </select>
            </div>
            {dealCreate.error && (
              <div className="font-mono text-xs text-error border border-error/40 bg-error/10 rounded px-3 py-2">
                {dealCreate.error.message}
              </div>
            )}
            <button
              type="submit"
              disabled={dealCreate.isPending || !form.dealId.trim() || !form.property.trim() || !form.priceAed}
              className="w-full bg-nexus text-black font-mono text-sm tracking-widest py-2 rounded hover:brightness-110 transition disabled:opacity-40"
            >
              {dealCreate.isPending ? "CREATING..." : "CREATE DEAL"}
            </button>
          </form>
        </div>

        {/* deal table */}
        <div className="lg:col-span-2">
          <div className="border border-surface-hover bg-surface rounded-lg p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">DEALS</h2>
            {dealList.error && (
              <div className="font-mono text-xs text-error border border-error/40 bg-error/10 rounded px-3 py-2 mb-3">
                {dealList.error.message}
              </div>
            )}
            {deals.length === 0 && !dealList.error && (
              <div className="font-mono text-xs text-text-muted border border-dashed border-surface-hover rounded px-3 py-8 text-center">
                <div className="tracking-[0.3em] text-[10px] mb-2">NO DEALS</div>
                <div className="text-text-secondary">Create a deal on the left, or import a live estate lead.</div>
              </div>
            )}
            <div className="space-y-2">
              {deals.map((d) => {
                const t = (d.tier ?? "LOW") as Tier;
                const meta = TIER[t];
                const score = Number(d.score ?? 0);
                return (
                  <div key={d.id} className="border border-surface-hover bg-void rounded px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-text-muted">{d.dealId}</span>
                      <span className="font-mono text-sm text-text-primary">{d.property}</span>
                      {d.area && <span className="font-mono text-[10px] text-text-secondary">· {d.area}</span>}
                      <span className={`font-mono text-[10px] tracking-wider px-1.5 py-0.5 rounded border ${meta.border} ${meta.text} ml-auto`}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <div className="flex items-center gap-1.5 flex-1">
                        <span className="font-mono text-[10px] text-text-muted">SCORE</span>
                        <div className="flex-1 h-1.5 bg-text-dim rounded overflow-hidden">
                          <div className="h-full bg-nexus" style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
                        </div>
                        <span className="font-mono text-[10px] text-text-secondary w-6 text-right">{score}</span>
                      </div>
                      <span className="font-mono text-xs text-success">{fmtAed(Number(d.priceAed))}</span>
                      {d.commission != null && (
                        <span className="font-mono text-[10px] text-text-muted">{Number(d.commission)}% com</span>
                      )}
                    </div>
                  </div>
                );
              })}
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

function Field({ placeholder, value, onChange, type = "text" }: { placeholder: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <input
      placeholder={placeholder}
      value={value}
      type={type}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-void border border-surface-hover rounded px-2 py-2 font-mono text-sm text-text-primary focus:border-nexus outline-none"
    />
  );
}