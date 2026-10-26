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
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Strict parse of an UPSTREAM numeric field: null/undefined/"" and anything
 * Number() rejects ("abc", "1e3x", "Infinity" after a bad parse) become NaN,
 * never 0. Use it where a garbage value must drop the whole record rather than
 * read as a valid zero (a zero liquidation LTV would be an hf=0, liquidatable
 * position). `num()` stays the lenient parser for USD sums.
 */
const STRICT_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

export function parseOrNaN(x: unknown): number {
  if (typeof x === "number") return Number.isFinite(x) ? x : NaN;
  // Only a plain decimal string (or a number-like with toString, e.g. a
  // Decimal) is a reading. Empty/whitespace, arrays, hex ("0x10") and anything
  // else Number() would coerce are garbage.
  if (typeof x !== "string" && (typeof x !== "object" || x === null || Array.isArray(x))) {
    return NaN;
  }
  const text = String(x).trim();
  return STRICT_NUMBER.test(text) ? Number(text) : NaN;
}

/** USD from a raw integer amount string in `decimals` smallest units × price. */
export function usdFromRaw(rawAmount: string | number | undefined, decimals: number, price: string | number | undefined): number {
  const amt = num(rawAmount);
  const p = num(price);
  if (amt === 0 || p === 0) return 0;
  return (amt / Math.pow(10, decimals)) * p;
}
