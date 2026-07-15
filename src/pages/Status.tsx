import { useState } from "react";
import {
  useSystemStatus,
  useSystemActivity,
  useSystemMetrics,
  useSystemHeartbeat,
  useWorkersAiProbe,
  useAuthListUsers,
  useAuthBootstrapAdmin,
  useAuthChangePassword,
} from "@/hooks/useSystemData";
import { getUser } from "@/lib/auth";

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider px-2 py-0.5 rounded border ${
        ok
          ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
          : "border-surface-hover text-text-muted bg-surface"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-text-muted"}`} />
      {label}
    </span>
  );
}

export default function Status() {
  const user = getUser();
  const isAdmin = user?.role === "admin";
  const status = useSystemStatus();
  const activity = useSystemActivity(40);
  const metrics = useSystemMetrics();
  const heartbeat = useSystemHeartbeat();
  const aiProbe = useWorkersAiProbe();
  const users = useAuthListUsers(!!isAdmin);
  const bootstrap = useAuthBootstrapAdmin();
  const changePw = useAuthChangePassword();

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const d = status.data;
  const integ = d?.integrations;

  async function onHeartbeat() {
    setMsg(null);
    try {
      await heartbeat.mutateAsync();
      status.refetch();
      activity.refetch();
      setMsg("Heartbeat written.");
    } catch (e: any) {
      setMsg(e?.message ?? "Heartbeat failed");
    }
  }

  async function onBootstrap() {
    setMsg(null);
    try {
      const r = await bootstrap.mutateAsync();
      if ((r as any).success === false) setMsg((r as any).error ?? "failed");
      else setMsg((r as any).created ? "Admin DB user created." : "Admin already in DB.");
      users.refetch();
    } catch (e: any) {
      setMsg(e?.message ?? "Bootstrap failed");
    }
  }

  async function onChangePw(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const r = await changePw.mutateAsync({ currentPassword: curPw, newPassword: newPw });
      if (r.success) {
        setMsg("Password updated.");
        setCurPw("");
        setNewPw("");
      } else setMsg(r.error ?? "Change failed");
    } catch (e: any) {
      setMsg(e?.message ?? "Change failed");
    }
  }

  return (
    <div className="space-y-8 max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="font-mono text-[10px] tracking-[0.35em] text-text-muted mb-1.5">OPS · TELEMETRY</div>
          <h1 className="font-display text-xl sm:text-2xl tracking-widest text-red-primary">SYSTEM STATUS</h1>
          <p className="font-mono text-xs text-text-muted mt-1">
            readiness · integrations · audit · metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          {d && (
            <span
              className={`font-mono text-xs tracking-wider px-3 py-1 rounded border ${
                d.status === "ready"
                  ? "border-emerald-500/40 text-emerald-400"
                  : "border-warning/40 text-warning"
              }`}
            >
              {d.status.toUpperCase()} · v{d.version}
            </span>
          )}
          <button
            onClick={() => { status.refetch(); activity.refetch(); metrics.refetch(); }}
            className="font-mono text-xs px-3 py-1 rounded border border-surface-hover text-text-secondary hover:text-text-primary"
          >
            REFRESH
          </button>
          {isAdmin && (
            <>
              <button
                onClick={onHeartbeat}
                disabled={heartbeat.isPending}
                className="font-mono text-xs px-3 py-1 rounded border border-red-primary/40 text-red-primary hover:bg-red-primary/10"
              >
                HEARTBEAT
              </button>
              <button
                onClick={async () => {
                  setMsg(null);
                  try {
                    const r = await aiProbe.mutateAsync();
                    setMsg(r.ok ? `Workers AI OK (${(r as any).latencyMs}ms)` : `Workers AI: ${(r as any).error}`);
                    activity.refetch();
                    status.refetch();
                  } catch (e: any) {
                    setMsg(e?.message ?? "AI probe failed");
                  }
                }}
                disabled={aiProbe.isPending}
                className="font-mono text-xs px-3 py-1 rounded border border-surface-hover text-text-secondary hover:text-text-primary"
              >
                AI PROBE
              </button>
            </>
          )}
        </div>
      </div>

      {msg && (
        <div className="font-mono text-xs text-text-secondary border border-surface-hover bg-surface px-3 py-2 rounded">
          {msg}
        </div>
      )}

      {/* Integration matrix */}
      <section>
        <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">INTEGRATIONS</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <Card title="Database" ok={!!integ?.database.ok}>
            <div className="space-y-1 font-mono text-xs text-text-secondary">
              <div>mode: {integ?.database.mode ?? "—"}</div>
              <div>agents: {integ?.database.agentCount ?? "—"}</div>
              {integ?.database.error && <div className="text-warning truncate">{integ.database.error}</div>}
            </div>
          </Card>
          <Card title="Auth" ok={!!integ?.auth.configured}>
            <div className="font-mono text-xs text-text-secondary">
              secret: {integ?.auth.hasCustomSecret ? "custom" : "dev-fallback"}
            </div>
          </Card>
          <Card title="OPA" ok={!!integ?.opa?.ok}>
            <div className="font-mono text-xs text-text-secondary">
              {integ?.opa?.ok
                ? `${integ.opa.latencyMs}ms`
                : integ?.opa?.error ?? "unreachable (expected on Pages)"}
            </div>
          </Card>
          <Card title="Live Estate" ok={!!integ?.estate?.ok}>
            <div className="font-mono text-xs text-text-secondary truncate">
              {integ?.estate?.ok
                ? `${integ.estate.latencyMs}ms`
                : integ?.estate?.error ?? "set ESTATE_API_URL"}
            </div>
          </Card>
          <Card title="Jarvis" ok={!!integ?.jarvis?.provider}>
            <div className="font-mono text-xs text-text-secondary">
              {integ?.jarvis?.provider ?? "—"} · {integ?.jarvis?.model ?? "—"}
            </div>
          </Card>
          <Card title="Workers AI" ok={!!integ?.workersAi?.configured}>
            <div className="font-mono text-xs text-text-secondary">
              {integ?.workersAi?.configured ? "AI binding live" : "redeploy with [ai] binding"}
            </div>
          </Card>
          <Card title="LLM providers" ok={!!(integ?.openrouter.configured || integ?.kimi.configured || integ?.openai.configured || integ?.ollama.configured)}>
            <div className="flex flex-wrap gap-1.5">
              <Pill ok={!!integ?.openrouter.configured} label="OpenRouter" />
              <Pill ok={!!integ?.kimi.configured} label="Kimi" />
              <Pill ok={!!integ?.openai.configured} label="OpenAI" />
              <Pill ok={!!integ?.anthropic.configured} label="Anthropic" />
              <Pill ok={!!integ?.ollama.configured} label={integ?.ollama?.cloud ? "Ollama Cloud" : "Ollama"} />
            </div>
          </Card>
          <Card title="Voice / social" ok={!!(integ?.elevenlabs.configured || integ?.postiz.configured)}>
            <div className="flex flex-wrap gap-1.5">
              <Pill ok={!!integ?.elevenlabs.configured} label="ElevenLabs" />
              <Pill ok={!!integ?.postiz.configured} label="Postiz" />
            </div>
          </Card>
          <Card title="Runtime" ok>
            <div className="font-mono text-xs text-text-secondary space-y-1">
              <div>uptime: {d?.uptimeSec ?? metrics.data?.uptimeSec ?? "—"}s</div>
              <div>demo: {d?.demo ? "yes" : "no"}</div>
              <div>ts: {d?.timestamp ? new Date(d.timestamp).toLocaleString() : "—"}</div>
            </div>
          </Card>
        </div>
      </section>

      {/* Metrics */}
      <section>
        <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">METRICS</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(metrics.data?.counters ?? {}).map(([k, v]) => (
            <div key={k} className="border border-surface-hover bg-surface rounded p-3">
              <div className="font-mono text-[10px] text-text-muted tracking-wider">{k}</div>
              <div className="font-display text-xl text-red-primary mt-1">{v}</div>
            </div>
          ))}
        </div>
        <p className="font-mono text-[10px] text-text-muted mt-2">
          Prometheus scrape: <code className="text-text-secondary">/api/metrics</code> · ready:{" "}
          <code className="text-text-secondary">/api/ready</code>
        </p>
      </section>

      {/* Activity */}
      <section>
        <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">
          ACTIVITY{" "}
          <span className="text-text-muted font-mono text-[10px]">
            source={activity.data?.source ?? "…"}
          </span>
        </h2>
        <div className="border border-surface-hover bg-surface rounded overflow-hidden">
          <table className="w-full text-left">
            <thead className="border-b border-surface-hover">
              <tr className="font-mono text-[10px] text-text-muted tracking-wider">
                <th className="px-3 py-2">WHEN</th>
                <th className="px-3 py-2">ACTOR</th>
                <th className="px-3 py-2">ACTION</th>
                <th className="px-3 py-2">DETAIL</th>
              </tr>
            </thead>
            <tbody>
              {(activity.data?.events ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 font-mono text-xs text-text-muted">
                    No events yet — log in or run HEARTBEAT.
                  </td>
                </tr>
              )}
              {(activity.data?.events ?? []).map((ev) => (
                <tr key={ev.id} className="border-t border-surface-hover/60 font-mono text-xs">
                  <td className="px-3 py-2 text-text-muted whitespace-nowrap">
                    {ev.createdAt ? new Date(ev.createdAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{ev.actor ?? "—"}</td>
                  <td className="px-3 py-2 text-red-primary">{ev.action}</td>
                  <td className="px-3 py-2 text-text-muted truncate max-w-xs">
                    {[ev.resource, ev.detail].filter(Boolean).join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Admin */}
      {isAdmin && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">USERS</h2>
            <div className="border border-surface-hover bg-surface rounded p-3 space-y-2">
              <button
                onClick={onBootstrap}
                disabled={bootstrap.isPending}
                className="font-mono text-xs px-3 py-1.5 rounded border border-red-primary/40 text-red-primary hover:bg-red-primary/10"
              >
                BOOTSTRAP ENV ADMIN → DB
              </button>
              <ul className="font-mono text-xs text-text-secondary space-y-1 mt-2">
                {(users.data?.users ?? []).map((u) => (
                  <li key={u.id} className="flex justify-between gap-2 border-t border-surface-hover/50 pt-1">
                    <span>{u.email}</span>
                    <span className="text-text-muted">{u.role}</span>
                  </li>
                ))}
                {(users.data?.users ?? []).length === 0 && (
                  <li className="text-text-muted">No DB users yet.</li>
                )}
              </ul>
            </div>
          </div>
          <div>
            <h2 className="font-display text-sm tracking-widest text-text-secondary mb-3">CHANGE PASSWORD</h2>
            <form onSubmit={onChangePw} className="border border-surface-hover bg-surface rounded p-3 space-y-2">
              <input
                type="password"
                placeholder="current password"
                value={curPw}
                onChange={(e) => setCurPw(e.target.value)}
                className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-xs text-text-primary outline-none focus:border-red-primary/40"
              />
              <input
                type="password"
                placeholder="new password (min 8)"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                className="w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-xs text-text-primary outline-none focus:border-red-primary/40"
              />
              <button
                type="submit"
                disabled={changePw.isPending || newPw.length < 8}
                className="font-mono text-xs px-3 py-1.5 rounded border border-surface-hover text-text-secondary hover:text-text-primary"
              >
                UPDATE
              </button>
              <p className="font-mono text-[10px] text-text-muted">
                Requires a DB user (run bootstrap if you only use env-admin).
              </p>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}

function Card({ title, ok, children }: { title: string; ok: boolean; children: React.ReactNode }) {
  return (
    <div className="border border-surface-hover bg-surface rounded p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-display text-xs tracking-widest text-text-secondary">{title}</h3>
        <span className={`w-2 h-2 rounded-full ${ok ? "bg-emerald-400" : "bg-warning"}`} />
      </div>
      {children}
    </div>
  );
}
