/**
 * Lightweight process metrics counters for /api/metrics and system.metrics.
 * Resets on isolate cold start (expected on Workers).
 */

const startedAt = Date.now();

const counters: Record<string, number> = {
  requests_total: 0,
  trpc_total: 0,
  login_success: 0,
  login_fail: 0,
  login_rate_limited: 0,
  activity_writes: 0,
  errors_total: 0,
};

export function inc(name: keyof typeof counters | string, by = 1) {
  counters[name] = (counters[name] ?? 0) + by;
}

export function getCounters() {
  return { ...counters };
}

export function getUptimeSec() {
  return Math.floor((Date.now() - startedAt) / 1000);
}

export function prometheusText(extra: Record<string, string | number> = {}) {
  const lines: string[] = [
    `# HELP sahiixx_up Always 1 if process is serving`,
    `# TYPE sahiixx_up gauge`,
    `sahiixx_up 1`,
    `# HELP sahiixx_uptime_seconds Process uptime`,
    `# TYPE sahiixx_uptime_seconds gauge`,
    `sahiixx_uptime_seconds ${getUptimeSec()}`,
  ];
  for (const [k, v] of Object.entries(counters)) {
    const metric = `sahiixx_${k}`;
    lines.push(`# TYPE ${metric} counter`);
    lines.push(`${metric} ${v}`);
  }
  for (const [k, v] of Object.entries(extra)) {
    const metric = `sahiixx_${k}`;
    lines.push(`# TYPE ${metric} gauge`);
    lines.push(`${metric} ${typeof v === "number" ? v : 0}`);
  }
  return lines.join("\n") + "\n";
}
