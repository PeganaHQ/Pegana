// "Worst-first" ordering shared by the mobile asset stack and the dashboard's
// default peek selection. Both must agree, and both must obey H1/H9: a
// KNOWN-stale snapshot degrades to UNKNOWN (lowest severity) so a frozen DEPEG
// can neither rank as "worst" nor get auto-selected into the peek pane off
// stale data. Pure module so the ordering is unit-testable.

import type { AssetCardData, PegState } from "@/lib/api/types";
import { reconcileBps } from "@/lib/api/format";
import { bandProximity } from "@/lib/asset/band";
import { thresholdsFor } from "@/lib/alerts/policy";
import { effectiveState, isStale } from "@/lib/asset/freshness";
import { isDirectionSensitiveClass } from "@/lib/asset/chart-thresholds";

export type LiveOverride = {
  state?: PegState;
  discount?: string;
  updated_at?: string;
};

/** Severity ramp for ordering. UNKNOWN is below PEGGED so a stale/unknown asset
 *  sinks to the bottom of a worst-first list rather than floating to the top. */
export const STATE_SEVERITY: Record<PegState, number> = {
  UNKNOWN: -1,
  PEGGED: 0,
  DRIFT: 1,
  DEPEG: 2,
  CRITICAL: 3,
  BLACK_SWAN: 4,
};

/** Proximity to the asset's own depeg line, freshness-gated: a stale snapshot
 *  contributes 0 (least-worst), never its frozen proximity. */
function proxOf(
  a: AssetCardData,
  liveOverrides: Record<string, LiveOverride>,
  now: number,
): number {
  if (isStale(liveOverrides[a.symbol]?.updated_at ?? a.updated_at, now))
    return 0;
  return (
    bandProximity(
      reconcileBps(a).bps,
      thresholdsFor(a.symbol, a.class, a.thresholds),
      // ADR-0021: a benign premium (negative bps) on a direction-sensitive class
      // contributes ZERO proximity — otherwise the worst-first order + the
      // 'state' tie-break rank a healthy LST/yield premium as "closer to depeg"
      // than an asset with a real discount, contradicting its own BandGauge.
      isDirectionSensitiveClass(a.class),
    ) ?? 0
  );
}

/**
 * Array.sort comparator: worst FIRST. Orders by freshness-gated state severity
 * (most severe first), tie-broken by proximity to the depeg line (closest
 * first). Stale snapshots degrade to UNKNOWN + proximity 0, so they sink last.
 */
export function compareWorstFirst(
  a: AssetCardData,
  b: AssetCardData,
  liveOverrides: Record<string, LiveOverride>,
  now: number,
): number {
  const sev =
    STATE_SEVERITY[effectiveState(liveOverrides[b.symbol], b, now)] -
    STATE_SEVERITY[effectiveState(liveOverrides[a.symbol], a, now)];
  if (sev !== 0) return sev;
  return proxOf(b, liveOverrides, now) - proxOf(a, liveOverrides, now);
}
