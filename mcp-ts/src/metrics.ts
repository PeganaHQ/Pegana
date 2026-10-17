// Minimal Prometheus-style metrics exposition.
//
// We don't pull in prom-client because the Pegana scrape target only
// needs counters + a couple of histograms, and prom-client adds
// ~150KB to the bundle and 200ms to cold-start. The same operator
// scrape job already consumes plain-text Prometheus output from the
// Rust services, so the format is exactly what's needed.
//
// Bounded memory: each histogram keeps the most-recent 10_000
// observations per label-set. Quantiles are computed on render —
// fine for /metrics scrape cadences of 15-60s, not for sub-second
// dashboards.

const counters = new Map<string, number>();
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
  for (const [k, v] of counters) {
    lines.push(`${k} ${v}`);
  }
  for (const [k, arr] of histograms) {
    const sorted = [...arr].sort((a, b) => a - b);
    const p50 = quantile(sorted, 0.5);
    const p99 = quantile(sorted, 0.99);
    // Convert {tool="x"} to {tool="x",quantile="0.5"} etc.
    const insertQuantile = (q: string, v: number) => {
      if (k.includes("{}") || k.endsWith("{}")) {
        return `${k.replace("{}", `{quantile="${q}"}`)} ${v}`;
      }
      return `${k.replace(/}$/, `,quantile="${q}"}`)} ${v}`;
    };
    lines.push(insertQuantile("0.5", p50));
    lines.push(insertQuantile("0.99", p99));
  }
  return lines.join("\n") + "\n";
}

// Convenience wrapper: time a tool handler, record latency + status.
// Used in server.ts to instrument each registered tool without
// boilerplate in every handler.
import * as Sentry from "@sentry/node";

export function withMetrics<TArgs, TRes>(
  toolName: string,
  handler: (args: TArgs) => Promise<TRes>,
): (args: TArgs) => Promise<TRes> {
  return async (args: TArgs) => {
    const start = Date.now();
    let status = "success";
    try {
      return await handler(args);
    } catch (e) {
      status = "error";
      Sentry.captureException(e, { tags: { tool: toolName } });
      throw e;
    } finally {
      incr("pegana_mcp_tool_calls_total", { tool: toolName, status });
      observe(
        "pegana_mcp_tool_latency_seconds",
        { tool: toolName },
        Date.now() - start,
      );
    }
  };
}
