import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell, Tooltip } from "recharts";
import { useContactList, useContactSearch, useContactCreate } from "@/hooks/useSahiixxData";
import { trpc } from "@/providers/trpc";

type Tier = "Champions" | "Top" | "Loyal" | "At Risk";

const TIER: Record<Tier, { label: string; color: string; text: string; border: string }> = {
  Champions: { label: "CHAMPIONS", color: "#FF1A1A", text: "text-error", border: "border-error/40" },
  Top: { label: "TOP", color: "#FFAA00", text: "text-warning", border: "border-warning/40" },
  Loyal: { label: "LOYAL", color: "#00CCFF", text: "text-info", border: "border-info/40" },
  "At Risk": { label: "AT RISK", color: "#555555", text: "text-text-muted", border: "border-text-muted/40" },
};
const TIERS: Tier[] = ["Champions", "Top", "Loyal", "At Risk"];

function fmtAed(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

export default function Goldmine() {
  const utils = trpc.useUtils();
  const contactList = useContactList();
  const createContact = useContactCreate();
  const [q, setQ] = useState("");
  const search = useContactSearch(q);

  const [form, setForm] = useState({
    name: "", phone: "", email: "", units: "", totalValue: "", rfmScore: "", tier: "Loyal" as Tier, area: "",
  });
  function setK(k: keyof typeof form, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  const list = q.length > 0 ? (search.data ?? []) : (contactList.data ?? []);
  const contacts = list;

  const counts: Record<Tier, number> = { Champions: 0, Top: 0, Loyal: 0, "At Risk": 0 };
  let totalValue = 0;
  for (const c of (contactList.data ?? [])) {
    const t = (c.tier ?? "Loyal") as Tier;
    if (t in counts) counts[t]++;
    totalValue += Number(c.totalValue ?? 0);
  }
  const tierData = TIERS.map((t) => ({ name: TIER[t].label, value: counts[t], color: TIER[t].color }));

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    await createContact.mutateAsync({
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      units: form.units ? Number(form.units) : undefined,
      totalValue: form.totalValue ? Number(form.totalValue) : undefined,
      rfmScore: form.rfmScore ? Number(form.rfmScore) : undefined,
      tier: form.tier,
      area: form.area.trim() || undefined,
    });
    utils.sahiixx.contactList.invalidate();
    if (q) utils.sahiixx.contactSearch.invalidate();
    setForm({ name: "", phone: "", email: "", units: "", totalValue: "", rfmScore: "", tier: "Loyal", area: "" });
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="font-display text-2xl tracking-widest text-goldmine">GOLDMINE CRM</h1>
        <span className="font-mono text-xs text-text-muted">contact intelligence · RFM tiering</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {TIERS.map((t) => (
          <div key={t} className={`border ${TIER[t].border} bg-surface rounded-lg p-4`}>
            <div className={`font-mono text-xs tracking-wider ${TIER[t].text}`}>{TIER[t].label}</div>
            <div className="font-display text-3xl text-text-primary mt-1">{counts[t]}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <div className="border border-surface-hover bg-surface rounded-lg p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-2">TIER DISTRIBUTION</h2>
            <div className="font-mono text-xs text-success mb-2">PORTFOLIO VALUE · {fmtAed(totalValue)} AED</div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tierData}>
                  <XAxis dataKey="name" tick={{ fill: "#888", fontFamily: "JetBrains Mono", fontSize: 9 }} axisLine={{ stroke: "#222" }} tickLine={false} />
                  <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                    {tierData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                  <Tooltip cursor={{ fill: "#22222255" }} contentStyle={{ background: "#111", border: "1px solid #222", borderRadius: 4, fontFamily: "JetBrains Mono", fontSize: 11 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <form onSubmit={onCreate} className="border border-surface-hover bg-surface rounded-lg p-4 space-y-3">
            <h2 className="font-display text-sm tracking-widest text-text-secondary">NEW CONTACT</h2>
            <Field placeholder="name" value={form.name} onChange={(v) => setK("name", v)} accent="goldmine" />
            <div className="grid grid-cols-2 gap-2">
              <Field placeholder="phone" value={form.phone} onChange={(v) => setK("phone", v)} accent="goldmine" />
              <Field placeholder="area" value={form.area} onChange={(v) => setK("area", v)} accent="goldmine" />
              <Field placeholder="email" value={form.email} onChange={(v) => setK("email", v)} accent="goldmine" />
              <Field placeholder="units" value={form.units} onChange={(v) => setK("units", v)} accent="goldmine" type="number" />
              <Field placeholder="total value (AED)" value={form.totalValue} onChange={(v) => setK("totalValue", v)} accent="goldmine" type="number" />
              <Field placeholder="RFM score" value={form.rfmScore} onChange={(v) => setK("rfmScore", v)} accent="goldmine" type="number" />
            </div>
            <select value={form.tier} onChange={(e) => setK("tier", e.target.value as Tier)}
              className="w-full bg-void border border-surface-hover rounded px-2 py-2 font-mono text-sm text-text-primary focus:border-goldmine outline-none">
              {TIERS.map((t) => <option key={t} value={t}>{TIER[t].label}</option>)}
            </select>
            {createContact.error && (
              <div className="font-mono text-xs text-error border border-error/40 bg-error/10 rounded px-3 py-2">{createContact.error.message}</div>
            )}
            <button type="submit" disabled={createContact.isPending || !form.name.trim()}
              className="w-full bg-goldmine text-black font-mono text-sm tracking-widest py-2 rounded hover:brightness-110 transition disabled:opacity-40">
              {createContact.isPending ? "SAVING..." : "ADD CONTACT"}
            </button>
          </form>
        </div>

        <div className="lg:col-span-2">
          <div className="border border-surface-hover bg-surface rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="font-display text-sm tracking-widest text-text-secondary">CONTACTS</h2>
              <input
                placeholder="search name or area..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="ml-auto bg-void border border-surface-hover rounded px-3 py-1.5 font-mono text-xs text-text-primary focus:border-goldmine outline-none w-56"
              />
            </div>
            {(q ? search.error : contactList.error) && (
              <div className="font-mono text-xs text-error border border-error/40 bg-error/10 rounded px-3 py-2 mb-3">
                {(q ? search.error : contactList.error)?.message}
              </div>
            )}
            {contacts.length === 0 && !(q ? search.error : contactList.error) && (
              <div className="font-mono text-xs text-text-muted">{q ? "no matches" : "no contacts"}</div>
            )}
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {contacts.map((c) => {
                  const t = (c.tier ?? "Loyal") as Tier;
                  const meta = TIER[t];
                  const rfm = Number(c.rfmScore ?? 0);
                  return (
                    <motion.div key={c.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                      className="border border-surface-hover bg-void rounded px-3 py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm text-text-primary">{c.name}</span>
                        {c.area && <span className="font-mono text-[10px] text-text-secondary">· {c.area}</span>}
                        <span className={`font-mono text-[10px] tracking-wider px-1.5 py-0.5 rounded border ${meta.border} ${meta.text} ml-auto`}>{meta.label}</span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 font-mono text-[10px]">
                        <span className="text-text-muted">{c.phone ?? "—"}</span>
                        <span className="text-text-muted">{c.email ?? "—"}</span>
                        <span className="text-text-secondary ml-auto">{c.units ?? 0} units</span>
                        <span className="text-success">{fmtAed(Number(c.totalValue))} AED</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="font-mono text-[10px] text-text-muted">RFM</span>
                        <div className="flex-1 h-1 bg-text-dim rounded overflow-hidden max-w-[120px]">
                          <div className="h-full bg-goldmine" style={{ width: `${Math.min(100, rfm)}%` }} />
                        </div>
                        <span className="font-mono text-[10px] text-text-secondary">{rfm}</span>
                      </div>
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

function Field({ placeholder, value, onChange, type = "text", accent = "goldmine" }: { placeholder: string; value: string; onChange: (v: string) => void; type?: string; accent?: string }) {
  const border = accent === "goldmine" ? "focus:border-goldmine" : "focus:border-surface-hover";
  return (
    <input placeholder={placeholder} value={value} type={type}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full bg-void border border-surface-hover rounded px-2 py-2 font-mono text-sm text-text-primary ${border} outline-none`} />
  );
}