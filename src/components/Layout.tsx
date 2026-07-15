import { useEffect, useState } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { clearSession, getUser } from "@/lib/auth";
import { useDbStatus, useModuleCounts } from "@/hooks/useSahiixxData";
import { useSystemStatus } from "@/hooks/useSystemData";
import { LiveDot, Chip } from "@/components/ui";

const navItems = [
  { path: "/hub", label: "HUB", short: "HUB" },
  { path: "/command-center", label: "COMMAND", short: "CMD" },
  { path: "/nexus", label: "NEXUS", short: "NEX" },
  { path: "/goldmine", label: "GOLDMINE", short: "GLD" },
  { path: "/sara", label: "SARA", short: "SARA" },
  { path: "/signals", label: "SIGNALS", short: "SIG" },
  { path: "/gapclaw", label: "GAPCLAW", short: "GAP" },
  { path: "/documents", label: "DOCUMENTS", short: "DOC" },
  { path: "/jarvis", label: "JARVIS", short: "JRV" },
  { path: "/status", label: "STATUS", short: "SYS" },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = getUser();
  const dbStatus = useDbStatus();
  const counts = useModuleCounts();
  const sys = useSystemStatus();
  const demo = dbStatus.data?.demo ?? false;
  const [menuOpen, setMenuOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Esc closes menu
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function logout() {
    clearSession();
    navigate("/login");
  }

  const estateOk = sys.data?.integrations?.estate?.ok;
  const estateConfigured = sys.data?.integrations?.estate?.configured;
  const ready = sys.data?.status === "ready";
  const c = counts.data;

  return (
    <div className="min-h-screen bg-black flex flex-col relative">
      {/* ambient grid */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.03] os-grid"
        aria-hidden
      />

      <header className="sticky top-0 z-40 border-b border-red-dark/30 bg-void/90 backdrop-blur-md">
        <nav className="px-3 sm:px-5 py-2.5 flex items-center gap-3">
          <Link
            to="/hub"
            className="font-display text-red-primary text-base sm:text-lg tracking-[0.25em] shrink-0 hover:text-red-glow transition-colors"
          >
            SAHIIXX
            <span className="text-text-muted font-mono text-[10px] tracking-normal ml-1.5 hidden sm:inline">
              OS
            </span>
          </Link>

          {/* Desktop nav — scroll if needed */}
          <div className="hidden lg:flex items-center gap-0.5 ml-2 overflow-x-auto no-scrollbar max-w-[55vw]">
            {navItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`font-mono text-[10px] tracking-wider px-2.5 py-1.5 rounded transition-all whitespace-nowrap ${
                    active
                      ? "bg-red-primary/15 text-red-primary shadow-[inset_0_-1px_0_0_rgba(255,26,26,0.6)]"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {/* Live chips — desktop */}
            <div className="hidden md:flex items-center gap-2">
              <Chip tone={demo ? "warn" : ready ? "ok" : "err"}>
                <LiveDot ok={!demo && !!ready} warn={demo} />
                {demo ? "DEMO" : ready ? "LIVE" : "DEGRADED"}
              </Chip>
              {estateConfigured && (
                <Chip tone={estateOk ? "ok" : "warn"}>
                  <LiveDot ok={!!estateOk} warn={!estateOk} />
                  ESTATE
                </Chip>
              )}
              {c && (
                <Chip tone="neutral">
                  {c.activeAgents}/{c.agents} AGENTS
                </Chip>
              )}
            </div>

            {user && (
              <span
                className="hidden sm:inline font-mono text-[10px] text-text-muted max-w-[140px] truncate"
                title={user.email}
              >
                {user.email}
              </span>
            )}

            <button
              type="button"
              onClick={logout}
              className="hidden sm:inline-flex font-mono text-[10px] tracking-wider px-2.5 py-1.5 rounded text-text-secondary hover:text-error border border-surface-hover hover:border-error/40 transition-colors"
            >
              LOGOUT
            </button>

            {/* Mobile menu toggle */}
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded border border-surface-hover text-text-secondary hover:text-red-primary hover:border-red-primary/40 transition-colors"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
            >
              <span className="font-mono text-xs tracking-widest">
                {menuOpen ? "✕" : "☰"}
              </span>
            </button>
          </div>
        </nav>

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="lg:hidden border-t border-surface-hover bg-void/98 px-3 py-3 space-y-1 max-h-[70vh] overflow-y-auto">
            <div className="flex flex-wrap gap-2 mb-3 px-1">
              <Chip tone={demo ? "warn" : ready ? "ok" : "err"}>
                <LiveDot ok={!demo && !!ready} warn={demo} />
                {demo ? "DEMO" : ready ? "LIVE" : "DEGRADED"}
              </Chip>
              {estateConfigured && (
                <Chip tone={estateOk ? "ok" : "warn"}>
                  <LiveDot ok={!!estateOk} warn={!estateOk} />
                  ESTATE {estateOk ? "UP" : "DOWN"}
                </Chip>
              )}
            </div>
            {navItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center justify-between font-mono text-xs tracking-wider px-3 py-2.5 rounded transition-colors ${
                    active
                      ? "bg-red-primary/15 text-red-primary"
                      : "text-text-secondary hover:bg-surface hover:text-text-primary"
                  }`}
                >
                  <span>{item.label}</span>
                  <span className="text-text-muted text-[10px]">{item.short}</span>
                </Link>
              );
            })}
            <button
              type="button"
              onClick={logout}
              className="w-full mt-2 font-mono text-xs tracking-wider px-3 py-2.5 rounded text-error border border-error/30 hover:bg-error/10"
            >
              LOGOUT {user?.email ? `· ${user.email}` : ""}
            </button>
          </div>
        )}
      </header>

      {demo && (
        <div className="bg-warning/10 border-b border-warning/40 px-4 sm:px-6 py-1.5 flex items-center gap-2">
          <LiveDot warn />
          <span className="font-mono text-[11px] tracking-wider text-warning">
            DEMO MODE — showing seeded data; writes are in-memory only.
          </span>
          <Link
            to="/status"
            className="font-mono text-[10px] text-text-muted ml-auto underline underline-offset-2 hover:text-warning"
          >
            STATUS
          </Link>
        </div>
      )}

      <main className="flex-1 p-4 sm:p-6 max-w-[1600px] w-full mx-auto relative z-[1]">
        <Outlet />
      </main>

      <footer className="border-t border-surface-hover/60 px-4 sm:px-6 py-2 flex items-center justify-between text-[10px] font-mono text-text-muted">
        <span className="tracking-wider">SAHIIXX OS · EDGE</span>
        <span className="tracking-wider truncate max-w-[50%] text-right">
          {location.pathname}
          {c?.source === "db" ? " · DB LIVE" : ""}
        </span>
      </footer>
    </div>
  );
}
