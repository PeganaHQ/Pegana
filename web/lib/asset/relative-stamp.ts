// Relative "Ns ago" stamp for freshness-sensitive surfaces (the dashboard peek
// pane), driven off a ticking `now` so a page-load absolute time can't
// masquerade as fresh (H1/H9). Seconds-granular near the live edge, coarsening
// to m/h/d. Unparseable/missing → undefined (the caller then renders just the
// state label). Pure module so the bucketing is unit-testable.

export function relativeStamp(
  updatedAt: string,
  nowMs: number,
): string | undefined {
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return undefined;
  const ms = Math.max(0, nowMs - t);
  if (ms < 10_000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}
