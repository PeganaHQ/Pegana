// Shared HF-distribution band logic — the anonymous cascade input, used by BOTH
// the Kamino and Jupiter Lend HF sources. Keeping ONE implementation means the
// k-anonymity + l-diversity invariants (ADR-0036 inv.7) can't drift per adapter.
//
// ADR-0036 variant A enforced here:
//   • a band with < K_MIN (5) obligations is DROPPED entirely (k-anonymity).
//   • a band where one obligation holds > 45% of the band collateral is
//     SUPPRESSED (l-diversity).
//   • position_bucket is a k-floored RANGE; no raw counts, no identity persisted.

import type { LoopHfBandRow } from "../db";
import { positionBucket, K_MIN } from "./loop-util";

export const DOMINANCE = 0.45; // ADR-0036 inv.7 l-diversity cap.

export const HF_BANDS = [
  "<1.0",
  "1.0-1.05",
  "1.05-1.1",
  "1.1-1.25",
  ">1.25",
] as const;

export function hfBand(hf: number): string {
  if (hf < 1.0) return "<1.0";
  if (hf < 1.05) return "1.0-1.05";
  if (hf < 1.1) return "1.05-1.1";
  if (hf < 1.25) return "1.1-1.25";
  return ">1.25";
}

/** One position's contribution — carries NO identity (no owner/wallet/pubkey). */
export interface HfEntry {
  hf: number;
  collateralUsd: number;
  debtUsd: number;
  liquidationLtv: number;
}

// PURE: fold per-position entries into k-floored, dominance-suppressed band rows.
// No I/O — unit-testable. `entries` carries NO identity.
export function computeHfBands(
  asset: string,
  protocol: string,
  entries: HfEntry[],
  ts: string,
  sourceSlot: number | null,
): LoopHfBandRow[] {
  const byBand = new Map<string, HfEntry[]>();
  for (const e of entries) {
    // Every field must be a finite, non-negative number. A NaN hf would fall
    // through every `<` comparison into the >1.25 band, and a negative or
    // infinite value would poison the sums. Zero is valid (a zero-collateral
    // position still counts toward the k-floor).
    if (
      ![e.hf, e.collateralUsd, e.debtUsd, e.liquidationLtv].every(
        (v) => Number.isFinite(v) && v >= 0,
      )
    ) {
      continue;
    }
    const b = hfBand(e.hf);
    (byBand.get(b) ?? byBand.set(b, []).get(b)!).push(e);
  }
  const rows: LoopHfBandRow[] = [];
  for (const band of HF_BANDS) {
    const es = byBand.get(band);
    if (!es || es.length < K_MIN) continue; // inv.7 k-floor: drop sparse bands
    const collSum = es.reduce((s, e) => s + e.collateralUsd, 0);
    const maxColl = es.reduce((m, e) => Math.max(m, e.collateralUsd), 0);
    if (collSum > 0 && maxColl / collSum > DOMINANCE) continue; // inv.7 l-diversity
    const debtSum = es.reduce((s, e) => s + e.debtUsd, 0);
    const liqAvg = es.reduce((s, e) => s + e.liquidationLtv, 0) / es.length;
    rows.push({
      asset,
      protocol,
      hf_band: band,
      position_bucket: positionBucket(es.length),
      collateral_usd: collSum.toString(),
      debt_usd: debtSum.toString(),
      liquidation_ltv: liqAvg.toFixed(6),
      liquidation_bonus: null,
      source_slot: sourceSlot,
      ts,
    });
  }
  return rows;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** True when an error looks like an RPC rate-limit (Helius 429). */
export function isRateLimited(e: unknown): boolean {
  const s = String(e);
  return s.includes("429") || s.includes("Too Many");
}
