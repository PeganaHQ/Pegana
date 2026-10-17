import { formatGap } from "@/lib/api/format";

export type ThresholdRole = "drift" | "depeg" | "critical";

export interface ThresholdLineSpec {
  /** Signed bps price for the guide line on the chart's discount axis. */
  price: number;
  role: ThresholdRole;
  /** Axis label, e.g. "drift +0.15%". */
  title: string;
}

export interface ThresholdAreaSpec {
  y1: number;
  y2: number;
  role: ThresholdRole;
}

export function isDirectionSensitiveClass(assetClass: string): boolean {
  return assetClass === "lst" || assetClass === "stable_yield";
}

/**
 * The dashed drift/depeg/critical guide lines for the spread chart.
 *
 * The engine classifies on |discount| (band magnitude), so a depeg can be a
 * discount (+bps, market BELOW intrinsic — where stablecoins break) or a
 * premium (−bps, ABOVE intrinsic). The chart plots the SIGNED discount, so a
 * guide drawn only on the negative side leaves the positive (discount) side —
 * exactly where a stablecoin depeg travels — without a reference line. Emit a
 * symmetric pair (±) for every band so the line always crosses the right guide
 * whichever way it moves. The zero (peg) line is drawn separately by the caller.
 */
/**
 * Symmetric visible price range (in bps) for the spread chart, so the dashed
 * guide lines don't force the y-axis open to ±critical.
 *
 * LWC price lines participate in autoscale by default, so once the guides are
 * symmetric the axis would span ±critical_bps — for a wide-band asset (xSOL:
 * critical = 6000 bps = ±120%) that squashes the live line into a flat trace.
 * Instead, scale to whichever is larger: the data's own peak magnitude or the
 * depeg band (so drift + depeg always frame the line, while critical only
 * comes into view as the line approaches it). Symmetric around zero so premium
 * (−) and discount (+) read on the same scale. Returns null for an empty
 * series (let LWC fall back to its default).
 */
export function priceRangeForGuides(
  values: number[],
  depegBps: number,
): { minValue: number; maxValue: number } | null {
  if (values.length === 0) return null;
  let maxAbs = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const a = Math.abs(v);
    if (a > maxAbs) maxAbs = a;
  }
  const bound = Math.round(Math.max(maxAbs, Math.abs(depegBps)) * 1.15);
  if (!(bound > 0)) return null;
  return { minValue: -bound, maxValue: bound };
}

export function thresholdLineSpecs(
  thresholds: {
    drift_bps: number;
    depeg_bps: number;
    critical_bps: number;
  },
  /**
   * Direction-sensitive classes (LST, stable_yield) only trip on the DISCOUNT
   * (+bps, market below NAV) side — a premium (−bps) normalizes to PEGGED no
   * matter how large (engine `is_direction_sensitive` / ADR-0021). Drawing
   * drift/depeg/critical guides on the premium side there is misleading: the
   * line can sit deep in a "critical" guide on the − side while the asset is
   * correctly PEGGED. So for those classes emit guides on the +discount side
   * only. Symmetric classes (fiat, dn, fx, synth_lev) keep both sides — a
   * stablecoin depeg can travel either way.
   */
  directionSensitive = false,
): ThresholdLineSpec[] {
  const bands: Array<{ bps: number; role: ThresholdRole }> = [
    { bps: thresholds.drift_bps, role: "drift" },
    { bps: thresholds.depeg_bps, role: "depeg" },
    { bps: thresholds.critical_bps, role: "critical" },
  ];
  const specs: ThresholdLineSpec[] = [];
  for (const { bps, role } of bands) {
    // The chart now plots the HOLDER-signed spread (premium +, discount −), so
    // the DISCOUNT/risk side that direction-sensitive classes (LST, stable_yield,
    // synth_lev) trip on is NEGATIVE. Emit the −bps guide (the risk side) always;
    // symmetric classes (fiat, dn, fx) add the +premium side too. (Flipped with
    // the series negation in asset-chart.tsx — QA audit 2026-07-23.)
    specs.push({ price: -bps, role, title: `${role} ${formatGap(-bps)}` });
    if (!directionSensitive) {
      specs.push({ price: bps, role, title: `${role} ${formatGap(bps)}` });
    }
  }
  return specs;
}

export function thresholdAreaSpecs(
  thresholds: {
    drift_bps: number;
    depeg_bps: number;
    critical_bps: number;
  },
  maxMagnitude: number,
  directionSensitive = false,
): ThresholdAreaSpec[] {
  const areas: ThresholdAreaSpec[] = [
    { y1: thresholds.drift_bps, y2: thresholds.depeg_bps, role: "drift" },
    {
      y1: thresholds.depeg_bps,
      y2: thresholds.critical_bps,
      role: "depeg",
    },
    {
      y1: thresholds.critical_bps,
      y2: maxMagnitude,
      role: "critical",
    },
  ];
  if (!directionSensitive) {
    areas.push(
      { y1: -thresholds.depeg_bps, y2: -thresholds.drift_bps, role: "drift" },
      {
        y1: -thresholds.critical_bps,
        y2: -thresholds.depeg_bps,
        role: "depeg",
      },
      {
        y1: -maxMagnitude,
        y2: -thresholds.critical_bps,
        role: "critical",
      },
    );
  }
  return areas;
}
