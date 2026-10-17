/**
 * Compact USD magnitude formatter for the /lst directory's TVL column —
 * "$784.20M" not "$784,202,863.60". Values under $1K render at full
 * precision: lst-directory.com's long tail includes dead/vanity LSTs with
 * single-digit-dollar TVL, and collapsing those to "$0K" would misrepresent
 * a real (if tiny) balance as zero.
 */
export function formatCompactUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

/**
 * APY as a friendly percentage — lst-directory.com ships APY as a decimal
 * fraction (0.0499 → "4.99%"), same convention Pegana's own `discount`
 * field uses elsewhere in the app.
 */
export function formatApyPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Stake-pool exchange rate (SOL per LST share) — lst-directory.com's `rate`
 * field. Returns `null` (not the string "-") on purpose: callers use this to
 * decide whether to render the secondary line under APY at all, rather than
 * showing a dash for every LST whose pool doesn't publish a rate.
 */
export function formatRate(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value.toFixed(4)} SOL/LST`;
}
