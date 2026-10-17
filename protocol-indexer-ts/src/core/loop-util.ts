// Shared loop-exposure helpers. The k-floor is ADR-0036 inv.7 (an obligation
// count is a RANGE, never a raw integer) — keeping ONE implementation means the
// privacy invariant can't drift between adapters.

export const K_MIN = 5; // ADR-0036 k-anonymity floor.

/** k-floored obligation-count RANGE. Never emit a raw count. */
export function positionBucket(n: number): string {
  if (n < K_MIN) return "<5";
  if (n < 20) return "5-20";
  if (n <= 50) return "20-50";
  return ">50";
}

/** Parse a possibly-string number, defaulting to 0 (never NaN). */
export function num(x: string | number | undefined | null): number {
  const n = typeof x === "number" ? x : parseFloat(x ?? "0");
  return Number.isFinite(n) ? n : 0;
}

/** USD from a raw integer amount string in `decimals` smallest units × price. */
export function usdFromRaw(rawAmount: string | number | undefined, decimals: number, price: string | number | undefined): number {
  const amt = num(rawAmount);
  const p = num(price);
  if (amt === 0 || p === 0) return 0;
  return (amt / Math.pow(10, decimals)) * p;
}
