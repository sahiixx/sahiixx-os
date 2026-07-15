import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-5 p-6 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 os-grid opacity-[0.05]" aria-hidden />
      <div className="font-mono text-[10px] tracking-[0.4em] text-text-muted">ERROR · ROUTE</div>
      <h1 className="font-display text-6xl sm:text-7xl text-red-primary tracking-widest">404</h1>
      <p className="font-mono text-sm text-text-secondary text-center max-w-sm">
        That path is not mounted in the OS shell.
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        <Link
          to="/hub"
          className="font-mono text-xs tracking-wider px-4 py-2 rounded bg-red-primary text-black hover:bg-red-glow transition-colors"
        >
          RETURN TO HUB
        </Link>
        <Link
          to="/status"
          className="font-mono text-xs tracking-wider px-4 py-2 rounded border border-surface-hover text-text-secondary hover:text-red-primary hover:border-red-primary/40 transition-colors"
        >
          SYSTEM STATUS
        </Link>
      </div>
    </div>
  );
}
