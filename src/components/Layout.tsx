import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { clearSession, getUser } from "@/lib/auth";
import { useDbStatus } from "@/hooks/useSahiixxData";

const navItems = [
  { path: "/hub", label: "HUB" },
  { path: "/command-center", label: "COMMAND" },
  { path: "/nexus", label: "NEXUS" },
  { path: "/goldmine", label: "GOLDMINE" },
  { path: "/sara", label: "SARA" },
  { path: "/signals", label: "SIGNALS" },
  { path: "/gapclaw", label: "GAPCLAW" },
  { path: "/documents", label: "DOCUMENTS" },
  { path: "/jarvis", label: "JARVIS" },
  { path: "/status", label: "STATUS" },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = getUser();
  const dbStatus = useDbStatus();
  const demo = dbStatus.data?.demo ?? false;

  function logout() {
    clearSession();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <nav className="border-b border-red-dark/30 bg-void px-6 py-3 flex items-center gap-6">
        <Link to="/hub" className="font-display text-red-primary text-lg tracking-widest">
          SAHIIXX OS
        </Link>
        <div className="flex gap-4 ml-auto items-center">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`font-mono text-xs tracking-wider px-3 py-1 rounded transition-colors ${
                location.pathname === item.path
                  ? "bg-red-primary/20 text-red-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {item.label}
            </Link>
          ))}
          {user && (
            <span className="font-mono text-xs text-text-muted ml-2">{user.email}</span>
          )}
          <button
            onClick={logout}
            className="font-mono text-xs tracking-wider px-3 py-1 rounded text-text-secondary hover:text-error border border-surface-hover hover:border-error/40 transition-colors"
          >
            LOGOUT
          </button>
        </div>
      </nav>

      {demo && (
        <div className="bg-warning/10 border-b border-warning/40 px-6 py-1.5 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-warning animate-status-pulse" />
          <span className="font-mono text-xs tracking-wider text-warning">
            DEMO MODE — Neon DB unreachable, showing seeded data. Writes go to in-memory store (lost on restart).
          </span>
          <span className="font-mono text-[10px] text-text-muted ml-auto hidden md:inline">
            fix DATABASE_URL in .dev.vars to switch live
          </span>
        </div>
      )}

      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}