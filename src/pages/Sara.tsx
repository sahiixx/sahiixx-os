import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import {
  useCampaignList, useVideoList, useCampaignCreate, useVideoCreate,
  usePostizIntegrations, usePostizSchedule,
} from "@/hooks/useSahiixxData";
import { trpc } from "@/providers/trpc";

type VideoStatus = "generating" | "editing" | "pending" | "published" | "failed";
type CampaignStatus = "draft" | "sending" | "sent" | "scheduled";

const VSTATUS: Record<VideoStatus, { label: string; color: string; text: string; dot: string }> = {
  generating: { label: "GENERATING", color: "#00DD77", text: "text-sara", dot: "bg-sara animate-status-pulse" },
  editing: { label: "EDITING", color: "#FFAA00", text: "text-warning", dot: "bg-warning" },
  pending: { label: "PENDING", color: "#00CCFF", text: "text-info", dot: "bg-info" },
  published: { label: "PUBLISHED", color: "#00FF66", text: "text-success", dot: "bg-success" },
  failed: { label: "FAILED", color: "#FF1A1A", text: "text-error", dot: "bg-error" },
};

const CSTATUS: Record<CampaignStatus, { label: string; text: string; border: string }> = {
  draft: { label: "DRAFT", text: "text-text-muted", border: "border-text-muted/40" },
  sending: { label: "SENDING", text: "text-sara", border: "border-sara/40" },
  sent: { label: "SENT", text: "text-success", border: "border-success/40" },
  scheduled: { label: "SCHEDULED", text: "text-info", border: "border-info/40" },
};

export default function Sara() {
  const utils = trpc.useUtils();
  const campaignList = useCampaignList();
  const videoList = useVideoList();
  const createCampaign = useCampaignCreate();
  const createVideo = useVideoCreate();

  const campaigns = campaignList.data ?? [];
  const videos = videoList.data ?? [];

  const [vForm, setVForm] = useState({ title: "", platform: "YouTube", status: "pending" as VideoStatus });
  const [cForm, setCForm] = useState({ name: "", template: "", language: "English" });

  // Postiz (real social scheduling) — optional backend.
  const postizIntegrations = usePostizIntegrations();
  const postizSchedule = usePostizSchedule();
  const postiz = postizIntegrations.data;
  const integrations = postiz?.integrations ?? [];
  const [pForm, setPForm] = useState({ integrationId: "", content: "", type: "now" as "now" | "schedule", date: "" });
  const [postizMsg, setPostizMsg] = useState<string | null>(null);

  async function onSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!pForm.integrationId || !pForm.content.trim()) return;
    const integ = integrations.find((i) => i.id === pForm.integrationId);
    setPostizMsg(null);
    const res = await postizSchedule.mutateAsync({
      integrationId: pForm.integrationId,
      platformType: integ?.type || "x",
      content: pForm.content.trim(),
      type: pForm.type,
      date: pForm.type === "schedule" ? (pForm.date ? new Date(pForm.date).toISOString() : new Date().toISOString()) : undefined,
    });
    if (res.ok) {
      setPostizMsg(`✓ ${pForm.type === "now" ? "Posted" : "Scheduled"}${res.id ? ` · ${res.id}` : ""}`);
      setPForm({ integrationId: pForm.integrationId, content: "", type: "now", date: "" });
    } else {
      setPostizMsg(`✕ ${res.error ?? "schedule failed"}`);
    }
  }

  const statusCounts: Record<VideoStatus, number> = { generating: 0, editing: 0, pending: 0, published: 0, failed: 0 };
  for (const v of videos) statusCounts[(v.status ?? "pending") as VideoStatus]++;
  const pieData = (Object.keys(statusCounts) as VideoStatus[]).map((s) => ({ name: VSTATUS[s].label, value: statusCounts[s], color: VSTATUS[s].color }));

  let totalSent = 0, totalDelivered = 0, totalOpened = 0;
  for (const c of campaigns) { totalSent += c.sent ?? 0; totalDelivered += c.delivered ?? 0; totalOpened += c.opened ?? 0; }
  const openRate = totalDelivered ? Math.round((totalOpened / totalDelivered) * 100) : 0;

  async function onCreateV(e: React.FormEvent) {
    e.preventDefault();
    if (!vForm.title.trim()) return;
    await createVideo.mutateAsync({ title: vForm.title.trim(), platform: vForm.platform, status: vForm.status });
    utils.sahiixx.videoList.invalidate();
    setVForm({ title: "", platform: "YouTube", status: "pending" });
  }
  async function onCreateC(e: React.FormEvent) {
    e.preventDefault();
    if (!cForm.name.trim()) return;
    await createCampaign.mutateAsync({ name: cForm.name.trim(), template: cForm.template.trim() || undefined, language: cForm.language });
    utils.sahiixx.campaignList.invalidate();
    setCForm({ name: "", template: "", language: "English" });
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="font-display text-2xl tracking-widest text-sara">SARA CONTENT FACTORY</h1>
        <span className="font-mono text-xs text-text-muted">campaigns · videos · multi-platform</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Tile label="CAMPAIGNS" value={String(campaigns.length)} accent="text-sara" />
        <Tile label="SENT" value={String(totalSent)} accent="text-info" />
        <Tile label="OPEN RATE" value={`${openRate}%`} accent="text-success" />
        <Tile label="VIDEOS" value={String(videos.length)} accent="text-warning" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <div className="border border-surface-hover bg-surface rounded-lg p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-2">VIDEO STATUS</h2>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={35} outerRadius={60} paddingAngle={2}>
                    {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#111", border: "1px solid #222", borderRadius: 4, fontFamily: "JetBrains Mono", fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <form onSubmit={onCreateV} className="border border-surface-hover bg-surface rounded-lg p-4 space-y-3">
            <h2 className="font-display text-sm tracking-widest text-text-secondary">NEW VIDEO</h2>
            <input placeholder="title" value={vForm.title} onChange={(e) => setVForm({ ...vForm, title: e.target.value })}
              className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-sara outline-none" />
            <select value={vForm.platform} onChange={(e) => setVForm({ ...vForm, platform: e.target.value })}
              className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-sara outline-none">
              {["YouTube", "Instagram", "TikTok", "LinkedIn"].map((p) => <option key={p}>{p}</option>)}
            </select>
            <select value={vForm.status} onChange={(e) => setVForm({ ...vForm, status: e.target.value as VideoStatus })}
              className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-sara outline-none">
              {(Object.keys(VSTATUS) as VideoStatus[]).map((s) => <option key={s} value={s}>{VSTATUS[s].label}</option>)}
            </select>
            <button type="submit" disabled={createVideo.isPending || !vForm.title.trim()}
              className="w-full bg-sara text-black font-mono text-sm tracking-widest py-2 rounded hover:brightness-110 transition disabled:opacity-40">
              {createVideo.isPending ? "QUEUING..." : "QUEUE VIDEO"}
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="border border-surface-hover bg-surface rounded-lg p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">VIDEO PIPELINE</h2>
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {videos.map((v) => {
                  const st = (v.status ?? "pending") as VideoStatus;
                  const meta = VSTATUS[st];
                  return (
                    <motion.div key={v.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="border border-surface-hover bg-void rounded px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} />
                        <span className="font-mono text-sm text-text-primary truncate">{v.title}</span>
                        <span className={`font-mono text-[10px] tracking-wider ${meta.text} ml-auto`}>{meta.label}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="font-mono text-[10px] text-text-muted">{v.platform ?? "—"}</span>
                        {(st === "generating" || st === "editing") && (
                          <div className="flex-1 h-1 bg-text-dim rounded overflow-hidden">
                            <div className="h-full bg-sara" style={{ width: `${Math.min(100, v.progress ?? 0)}%` }} />
                          </div>
                        )}
                        {v.duration != null && st === "published" && <span className="font-mono text-[10px] text-text-secondary ml-auto">{v.duration}s</span>}
                        <span className="font-mono text-[10px] text-text-muted">{v.createdAt ? new Date(v.createdAt).toLocaleDateString() : ""}</span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {videos.length === 0 && <div className="font-mono text-xs text-text-muted">no videos</div>}
            </div>
          </div>

          <div className="border border-surface-hover bg-surface rounded-lg p-4">
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">CAMPAIGNS</h2>
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {campaigns.map((c) => {
                  const st = (c.status ?? "draft") as CampaignStatus;
                  const meta = CSTATUS[st];
                  const sent = c.sent ?? 0, delivered = c.delivered ?? 0, opened = c.opened ?? 0;
                  const openPct = delivered ? Math.round((opened / delivered) * 100) : 0;
                  const delivPct = sent ? Math.round((delivered / sent) * 100) : 0;
                  return (
                    <motion.div key={c.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="border border-surface-hover bg-void rounded px-3 py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm text-text-primary">{c.name}</span>
                        <span className={`font-mono text-[10px] tracking-wider px-1.5 py-0.5 rounded border ${meta.border} ${meta.text} ml-auto`}>{meta.label}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 font-mono text-[10px] text-text-muted">
                        <span>{c.template ?? "—"}</span>
                        <span>· {c.language}</span>
                        {sent > 0 && (
                          <span className="ml-auto flex items-center gap-2">
                            <span>{sent} sent</span>
                            <span className="text-text-secondary">→ {delivPct}% delivered</span>
                            <span className="text-success">{openPct}% opened</span>
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {campaigns.length === 0 && <div className="font-mono text-xs text-text-muted">no campaigns</div>}
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={onCreateC} className="mt-6 border border-surface-hover bg-surface rounded-lg p-4 max-w-xl">
        <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">NEW CAMPAIGN</h2>
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="campaign name" value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })}
            className="bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-sara outline-none" />
          <input placeholder="template" value={cForm.template} onChange={(e) => setCForm({ ...cForm, template: e.target.value })}
            className="bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-sara outline-none" />
          <select value={cForm.language} onChange={(e) => setCForm({ ...cForm, language: e.target.value })}
            className="bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-sara outline-none col-span-2">
            {["English", "Arabic", "Hindi", "Russian"].map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
        <button type="submit" disabled={createCampaign.isPending || !cForm.name.trim()}
          className="w-full bg-sara/80 text-black font-mono text-sm tracking-widest py-2 rounded hover:bg-sara transition disabled:opacity-40 mt-3">
          {createCampaign.isPending ? "CREATING..." : "CREATE CAMPAIGN"}
        </button>
      </form>

      {/* ── Postiz (real social scheduling) ─────────────────────────────────── */}
      <div className="mt-6 border border-surface-hover bg-surface rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-display text-sm tracking-widest text-text-secondary">POSTIZ · SOCIAL SCHEDULER</h2>
          {postiz?.available ? (
            <span className="flex items-center gap-1.5 font-mono text-xs text-success ml-auto">
              <span className="inline-block w-2 h-2 rounded-full bg-success animate-status-pulse" />
              CONNECTED · {integrations.length} channels
            </span>
          ) : (
            <span className="font-mono text-xs text-text-muted ml-auto">NOT CONNECTED</span>
          )}
        </div>
        {postiz?.error && (
          <div className="font-mono text-xs text-error border border-error/40 bg-error/10 rounded px-3 py-2 mb-3">{postiz.error}</div>
        )}
        {postiz?.available ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <div className="font-mono text-[10px] text-text-muted mb-2 tracking-wider">CHANNELS</div>
              <div className="space-y-1.5">
                {integrations.map((i) => (
                  <div key={i.id} className="flex items-center gap-2 font-mono text-xs">
                    <span className="inline-block w-2 h-2 rounded-full bg-sara" />
                    <span className="text-text-primary truncate">{i.name || i.id}</span>
                    <span className="text-text-muted text-[10px] ml-auto">{i.type || "channel"}</span>
                  </div>
                ))}
                {integrations.length === 0 && <div className="font-mono text-xs text-text-muted">no channels connected in Postiz</div>}
              </div>
            </div>
            <form onSubmit={onSchedule} className="space-y-2">
              <select value={pForm.integrationId} onChange={(e) => setPForm({ ...pForm, integrationId: e.target.value })}
                className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-sara outline-none">
                <option value="">select channel…</option>
                {integrations.map((i) => <option key={i.id} value={i.id}>{i.name || i.id} · {i.type}</option>)}
              </select>
              <textarea placeholder="post content…" value={pForm.content} onChange={(e) => setPForm({ ...pForm, content: e.target.value })} rows={3}
                className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-sara outline-none resize-none" />
              <div className="grid grid-cols-2 gap-2">
                <select value={pForm.type} onChange={(e) => setPForm({ ...pForm, type: e.target.value as "now" | "schedule" })}
                  className="bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-sara outline-none">
                  <option value="now">post now</option>
                  <option value="schedule">schedule</option>
                </select>
                {pForm.type === "schedule" && (
                  <input type="datetime-local" value={pForm.date} onChange={(e) => setPForm({ ...pForm, date: e.target.value })}
                    className="bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-sara outline-none" />
                )}
              </div>
              {postizMsg && <div className="font-mono text-xs text-text-secondary">{postizMsg}</div>}
              <button type="submit" disabled={postizSchedule.isPending || !pForm.integrationId || !pForm.content.trim()}
                className="w-full bg-sara text-black font-mono text-sm tracking-widest py-2 rounded hover:brightness-110 transition disabled:opacity-40">
                {postizSchedule.isPending ? "SENDING..." : pForm.type === "now" ? "POST NOW" : "SCHEDULE POST"}
              </button>
            </form>
          </div>
        ) : (
          <p className="font-mono text-xs text-text-muted">
            Local tracking mode. Set <span className="text-text-secondary">POSTIZ_API_URL</span> + <span className="text-text-secondary">POSTIZ_API_KEY</span> in
            {" "}.dev.vars to enable real multi-platform scheduling (cloud <span className="text-text-secondary">api.postiz.com/public/v1</span> or self-hosted).
          </p>
        )}
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