import type { ReactNode } from "react";

/** Pulsing live indicator — use for system health chips. */
export function LiveDot({
  ok = true,
  warn = false,
  className = "",
}: {
  ok?: boolean;
  warn?: boolean;
  className?: string;
}) {
  const color = warn ? "bg-warning" : ok ? "bg-success" : "bg-error";
  return (
    <span className={`relative inline-flex h-2 w-2 ${className}`} aria-hidden>
      <span className={`absolute inset-0 rounded-full ${color} opacity-60 animate-ping`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  accent = "text-red-primary",
  children,
}: {
  eyebrow?: string;
  title: string;
  accent?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6 sm:mb-8">
      <div className="min-w-0">
        {eyebrow && (
          <div className="font-mono text-[10px] tracking-[0.35em] text-text-muted mb-1.5 uppercase">
            {eyebrow}
          </div>
        )}
        <h1 className={`font-display text-xl sm:text-2xl tracking-[0.2em] ${accent} truncate`}>
          {title}
        </h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 shrink-0">{children}</div>}
    </header>
  );
}

export function Panel({
  children,
  className = "",
  accentBorder,
}: {
  children: ReactNode;
  className?: string;
  accentBorder?: string;
}) {
  return (
    <div
      className={`border bg-surface/80 backdrop-blur-sm rounded-lg ${
        accentBorder ?? "border-surface-hover"
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "err" | "info";
}) {
  const tones = {
    neutral: "border-surface-hover text-text-secondary bg-void",
    ok: "border-success/30 text-success bg-success/5",
    warn: "border-warning/30 text-warning bg-warning/5",
    err: "border-error/30 text-error bg-error/5",
    info: "border-info/30 text-info bg-info/5",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider px-2 py-1 rounded border ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-surface-hover/60 ${className}`}
      aria-hidden
    />
  );
}
