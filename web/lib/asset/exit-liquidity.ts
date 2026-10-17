// Pure depth-curve helpers for the exit-liquidity section. No React, no DOM —
// the slippage/threshold logic is unit-testable in isolation.

/** Price impact (%) at/above which exit slippage reads as a depeg-tier loss
 *  (the red band). Matches the impactColor breakpoint below. */
export const IMPACT_THRESHOLD_PCT = 0.3;

/** USDC value formatter (M / k / cents). */
export function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${n.toFixed(2)}`;
}

/** Compact exit-size label for the ladder (covers the $1k→$1M desktop range). */
export function fmtSize(n: number): string {
  if (n >= 1_000_000)
    return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

/** Tailwind text color for a price-impact %: green <0.05, amber <0.3, red ≥0.3. */
export function impactColor(pct: number): string {
  if (pct < 0.05) return "text-st-pegged";
  if (pct < IMPACT_THRESHOLD_PCT) return "text-st-drift";
  return "text-st-depeg-text";
}

/** Minimal row shape the safe-exit math reads (a sampled size + its impact). */
export interface ExitQuoteRow {
  sizeUsd: number;
  impactPct: number | null;
}

/**
 * The "safe-exit size": the largest sampled size whose price impact stays
 * STRICTLY UNDER the threshold (default 0.3% — the depeg-tier slippage line,
 * matching impactColor). Rows with a null impact (loading/failed) are ignored.
 * Returns null when no sampled size clears the threshold.
 *
 * Deliberately makes NO monotonicity assumption: Jupiter route-splitting
 * legitimately yields non-monotonic impact across sizes (different pools fill
 * different notionals), so we simply take the largest size that clears — never
 * null-out an otherwise-valid curve just because it dipped.
 */
export function safeExitSize(
  rows: readonly ExitQuoteRow[],
  thresholdPct: number = IMPACT_THRESHOLD_PCT,
): number | null {
  let largest: number | null = null;
  for (const r of rows) {
    if (r.impactPct == null || r.impactPct >= thresholdPct) continue;
    if (largest == null || r.sizeUsd > largest) largest = r.sizeUsd;
  }
  return largest;
}
