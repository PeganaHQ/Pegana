// Pure math for the live verdict playground's threshold scale. The engine
// classifies on |discount|, so the scale plots magnitude in basis points.

export interface BandThresholds {
  drift_bps: number;
  depeg_bps: number;
  critical_bps: number;
}

export interface ScaleBand {
  id: "pegged" | "drift" | "depeg" | "critical";
  /** Start and end as a percentage of the scale width. */
  from: number;
  to: number;
}

/** The scale runs 0 .. critical * 1.25 so the critical band is visible. */
export function scaleMaxBps(t: BandThresholds): number {
  return t.critical_bps * 1.25;
}

export function scaleBands(t: BandThresholds): ScaleBand[] {
  const max = scaleMaxBps(t);
  const pct = (bps: number) => (bps / max) * 100;
  return [
    { id: "pegged", from: 0, to: pct(t.drift_bps) },
    { id: "drift", from: pct(t.drift_bps), to: pct(t.depeg_bps) },
    { id: "depeg", from: pct(t.depeg_bps), to: pct(t.critical_bps) },
    { id: "critical", from: pct(t.critical_bps), to: 100 },
  ];
}

/** Marker position in percent of scale width, clamped to [0, 100]. */
export function markerPercent(discountBps: number, t: BandThresholds): number {
  const p = (Math.abs(discountBps) / scaleMaxBps(t)) * 100;
  return Math.min(100, Math.max(0, p));
}

/** Signed discount fraction string -> basis points (not rounded). */
export function fractionToBps(d: string | null | undefined): number | null {
  if (d == null) return null;
  const n = Number(d);
  return Number.isFinite(n) ? n * 10_000 : null;
}

export function formatUsd(v: string | null | undefined): string {
  if (v == null) return "n/a";
  const n = Number(v);
  if (!Number.isFinite(n)) return "n/a";
  return `$${n >= 100 ? n.toFixed(2) : n.toFixed(4)}`;
}

export function formatBps(bps: number): string {
  const sign = bps > 0 ? "+" : bps < 0 ? "-" : "";
  return `${sign}${Math.abs(bps).toFixed(1)} bps`;
}

export type SurfaceId = "rest" | "ws" | "mcp" | "cli";

/** The single copyable line per surface, real routes only. */
export function requestLine(
  surface: SurfaceId,
  symbol: string,
  alertId = "<id>",
): string {
  switch (surface) {
    case "rest":
      return `GET https://api.pegana.xyz/v1/assets/${encodeURIComponent(symbol)}`;
    case "ws":
      return `wss://api.pegana.xyz/v1/ws  {"op":"subscribe","assets":["${symbol}"]}`;
    case "mcp":
      return `get_asset_state {"symbol":"${symbol}"}`;
    case "cli":
      return `pegana-replay --alert-id ${alertId}`;
  }
}
