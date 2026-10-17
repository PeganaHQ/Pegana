import type { AlertThresholds } from "@/lib/alerts/policy";

export type BandZone = "pegged" | "drift" | "depeg" | "critical" | "unknown";

/**
 * How close the current |spread| sits to the asset's OWN depeg threshold,
 * expressed as a fraction: 0 = perfect peg, 1 = exactly at the depeg line,
 * >1 = beyond it. This is the on-thesis risk-oracle signal the raw spread
 * column hides — −40 bps is 80% of the way to depeg for USDC (depeg 50) but
 * only ~14% for INF (depeg 280). Drives both the per-row micro-gauge fill and
 * a "closest to breaking" sort.
 *
 * `bps` follows the reconcileBps sign convention (positive = discount, market
 * BELOW intrinsic; negative = premium, market ABOVE intrinsic). By default
 * this is sign-independent (|bps|), matching the engine's symmetric classes
 * (fiat/CDP/DN/FX stables, synth_lev). Pass `directionSensitive = true` for
 * LST / stable_yield (ADR-0021 carve-out): a premium is benign — holders
 * always redeem at the intrinsic rate — so it contributes ZERO proximity;
 * only the discount side counts toward the depeg band.
 */
export function bandProximity(
  bps: number | null | undefined,
  t: AlertThresholds,
  directionSensitive = false,
): number | null {
  if (bps == null || !Number.isFinite(bps)) return null;
  if (!t || !(t.depeg_bps > 0)) return null;
  if (directionSensitive && bps < 0) return 0;
  return Math.abs(bps) / t.depeg_bps;
}

/** Which band the current |spread| falls in, by the asset's own thresholds. */
export function bandZone(
  bps: number | null | undefined,
  t: AlertThresholds,
): BandZone {
  if (bps == null || !Number.isFinite(bps) || !t) return "unknown";
  const abs = Math.abs(bps);
  if (abs >= t.critical_bps) return "critical";
  if (abs >= t.depeg_bps) return "depeg";
  if (abs >= t.drift_bps) return "drift";
  return "pegged";
}
