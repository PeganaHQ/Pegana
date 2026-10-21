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

/** Impact (%) below which the ladder prints "<0.001%" instead of a number. */
export const IMPACT_DISPLAY_FLOOR_PCT = 0.001;

/**
 * The largest sampled size when EVERY row's impact is below the display floor
 * (a flat curve with nothing to draw, e.g. jitoSOL). Null when any row has a
 * visible impact, any row has no impact yet (loading/failed), or there are no
 * rows.
 */
export function noMeasurableImpactUpTo(
  rows: readonly ExitQuoteRow[],
): number | null {
  if (rows.length === 0) return null;
  let largest = 0;
  for (const r of rows) {
    if (r.impactPct == null || !Number.isFinite(r.impactPct) || r.impactPct >= IMPACT_DISPLAY_FLOOR_PCT)
      return null;
    if (r.sizeUsd > largest) largest = r.sizeUsd;
  }
  return largest;
}

/** Relative market move below which the ladder keeps its current quotes. */
export const REQUOTE_MOVE_FRACTION = 0.01;

/**
 * The market price the quote ladder is computed from.
 *
 * The asset detail refreshes every 30s and `market_usd` moves in the last
 * digits on almost every poll. The ladder used to re-run its five sequential
 * Jupiter quotes on each of those changes: 17 `/api/jupiter-quote` calls in
 * one minute on one open tab (measured 2026-10-21), each a function
 * invocation and a request against the shared Jupiter key. A sub-1% move does
 * not change what the ladder shows, so the price only advances when it moves
 * by at least `REQUOTE_MOVE_FRACTION`.
 */
export function nextQuotePrice(
  current: number | null,
  incoming: number | null,
): number | null {
  if (incoming == null || !Number.isFinite(incoming) || incoming <= 0) {
    return current;
  }
  if (current == null) return incoming;
  return Math.abs(incoming - current) / current >= REQUOTE_MOVE_FRACTION
    ? incoming
    : current;
}

/**
 * Input amount in base units for a USD size, rounded to three significant
 * figures. Every visitor on the same asset then asks for the same amount, so
 * the proxy's 60s CDN cache (`s-maxage=60`) can serve repeats instead of each
 * request reaching Jupiter. The rounding moves the size by at most 0.5%. That
 * is below the precision of the impact percentage, but not of the dollar
 * amount received: use `scaleOutToRequestedSize` before showing `outAmount`
 * beside the unrounded size.
 */
export function quoteAmountBaseUnits(
  sizeUsd: number,
  marketUsd: number,
  decimals: number,
): number {
  const raw = (sizeUsd / marketUsd) * Math.pow(10, decimals);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 2));
  return Math.max(1, Math.round(raw / magnitude) * magnitude);
}

/**
 * USDC received, rescaled from the amount actually quoted to the size the row
 * shows. `quoteAmountBaseUnits` rounds the input, so the raw `outAmount` is for
 * a size up to 0.5% off the labelled one (USDT at 0.9988 and $10k: 10012 tokens
 * rounded to 10000, about $12 less received). Left unscaled, that gap reads as
 * slippage. Impact is unchanged over a 0.5% size move, so a linear rescale is
 * honest. Returns null when the quoted size cannot be computed.
 */
export function scaleOutToRequestedSize(
  usdcOut: number,
  inputAmount: number,
  sizeUsd: number,
  marketUsd: number,
  decimals: number,
): number | null {
  const quotedUsd = (inputAmount * marketUsd) / Math.pow(10, decimals);
  if (!Number.isFinite(usdcOut) || !Number.isFinite(quotedUsd) || quotedUsd <= 0) {
    return null;
  }
  return usdcOut * (sizeUsd / quotedUsd);
}
