import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isAuthenticated } from "@/lib/auth";

const lines = [
  { t: "> SAHIIXX OS v4.3.0 — EDGE BOOT", c: "text-red-primary" },
  { t: "> NEON POSTGRES …………… LINK", c: "text-success" },
  { t: "> HYPERDRIVE / WORKERS AI … READY", c: "text-success" },
  { t: "> NEXUS DEAL ENGINE ……… OK", c: "text-nexus" },
  { t: "> GOLDMINE CRM …………… OK", c: "text-goldmine" },
  { t: "> SARA / SIGNALS / GAPCLAW … OK", c: "text-sara" },
  { t: "> JARVIS · OLLAMA CLOUD …… STANDBY", c: "text-gapclaw" },
  { t: "> ALL SYSTEMS OPERATIONAL", c: "text-success" },
  { t: "", c: "" },
  { t: "> ENTERING COMMAND DECK…", c: "text-red-primary" },
];

export default function Boot() {
  const [visible, setVisible] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible((v) => {
        if (v >= lines.length) {
          clearInterval(timer);
          setTimeout(() => navigate(isAuthenticated() ? "/hub" : "/login"), 500);
          return v;
        }
        return v + 1;
      });
    }, 220);
    return () => clearInterval(timer);
  }, [navigate]);

  function skip() {
    navigate(isAuthenticated() ? "/hub" : "/login");
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6 sm:p-8 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 os-grid opacity-[0.05]" aria-hidden />
      <div className="relative font-mono text-xs sm:text-sm max-w-xl w-full space-y-1">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[10px] tracking-[0.4em] text-text-muted">BOOT</span>
          <button
            type="button"
            onClick={skip}
            className="text-[10px] tracking-wider text-text-muted hover:text-red-primary border border-surface-hover hover:border-red-primary/40 px-2 py-1 rounded transition-colors"
          >
            SKIP →
          </button>
        </div>
        {lines.slice(0, visible).map((line, i) => (
          <div
            key={i}
            className={`${line.c || "text-text-muted"} animate-fade-up min-h-[1.1em]`}
          >
            {line.t || "\u00a0"}
          </div>
        ))}
        {visible < lines.length && (
          <span className="inline-block w-2 h-4 bg-red-primary animate-cursor-blink align-middle" />
        )}
      </div>
    </div>
  );
}
