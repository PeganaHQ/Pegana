// Minimal Prometheus-style metrics exposition (mirrors mcp-ts/src/metrics.ts,
// plus GAUGES for per-source liveness — the crates/indexer-rs pattern).
//
// No prom-client: the operator scrape job already consumes plain-text
// Prometheus from the Rust services, so this is exactly the needed format.

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const histograms = new Map<string, number[]>();

const HIST_CAP = 10_000;

function labelString(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}="${v}"`).join(",");
}

export function incr(
  name: string,
  labels: Record<string, string> = {},
  by = 1,
): void {
  const key = `${name}{${labelString(labels)}}`;
  counters.set(key, (counters.get(key) ?? 0) + by);
}

// Set-value gauge — used for `pegana_protocol_source_task_up{source}` (1 while a
// source loop is running, 0 on exit incl. unwind) and the freshness timestamp.
export function setGauge(
  name: string,
  labels: Record<string, string>,
  value: number,
): void {
  const key = `${name}{${labelString(labels)}}`;
  gauges.set(key, value);
}

export function observe(
  name: string,
  labels: Record<string, string>,
  valueMs: number,
): void {
  const key = `${name}{${labelString(labels)}}`;
  const arr = histograms.get(key) ?? [];
  arr.push(valueMs);
  if (arr.length > HIST_CAP) arr.splice(0, arr.length - HIST_CAP);
  histograms.set(key, arr);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx] ?? 0;
}

export function renderProm(): string {
  const lines: string[] = [];
  for (const [k, v] of counters) lines.push(`${k} ${v}`);
  for (const [k, v] of gauges) lines.push(`${k} ${v}`);
  for (const [k, arr] of histograms) {
    const sorted = [...arr].sort((a, b) => a - b);
    const insertQuantile = (q: string, v: number) =>
      k.endsWith("{}")
        ? `${k.replace("{}", `{quantile="${q}"}`)} ${v}`
        : `${k.replace(/}$/, `,quantile="${q}"}`)} ${v}`;
    lines.push(insertQuantile("0.5", quantile(sorted, 0.5)));
    lines.push(insertQuantile("0.99", quantile(sorted, 0.99)));
  }
  return lines.join("\n") + "\n";
}
