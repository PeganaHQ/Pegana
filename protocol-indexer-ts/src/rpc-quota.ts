// Distinguishing a RATE LIMIT from a QUOTA EXHAUSTION.
//
// Both arrive as HTTP 429, and treating them the same is what broke Sub-C's
// health-factor sources for 8 days (2026-08-02 to 2026-08-10).
//
//   - A rate limit means "too fast, slow down". Backing off and retrying is
//     exactly right; the next attempt can succeed.
//   - A quota exhaustion means "this plan's allowance is spent". Retrying
//     cannot succeed until the billing period rolls over, and every retry
//     spends another request against an allowance that is already gone.
//
// The old code tested `String(e).includes("429")` and retried 5 times per
// vault, per reserve, every 10 minutes. Measured on production 2026-08-10:
// 429 requests returning 429 in a 20-minute window, roughly 31k wasted calls a
// day, about 250k over the eight days it ran. Worse, the storm would re-burn
// the allowance the instant it reset, so the source could never self-heal.
//
// Helius signals exhaustion with "max usage reached" in the body. Treat that as
// terminal for the cycle: stop retrying, stop iterating, and report it as its
// own condition so the operator sees "quota exhausted" rather than a generic
// stale-source alert. Same shape as `ClickhouseApiError.permanent` in
// solana-foundation/tokens, which aborts a batch on a permanent 4xx instead of
// hammering every remaining chunk against the same wall.

/** Classification of an upstream failure for retry purposes. */
export type RpcFailureKind = "quota_exhausted" | "rate_limited" | "other";

/**
 * Phrases Helius uses when the plan allowance is spent. Deliberately narrow:
 * a false "quota_exhausted" would suppress legitimate retries, so anything
 * ambiguous falls through to `rate_limited` and keeps the old behaviour.
 */
const QUOTA_MARKERS = [
  "max usage reached",
  "max usage",
  "credits exhausted",
  "quota exceeded",
  "usage limit",
  "plan limit",
];

export function classifyRpcFailure(e: unknown): RpcFailureKind {
  const s = String(
    (e as { message?: unknown } | null)?.message ?? e ?? "",
  ).toLowerCase();

  // Check exhaustion FIRST: a quota error is also a 429, so testing for the
  // generic 429 first would always win and the distinction would be dead code.
  if (QUOTA_MARKERS.some((m) => s.includes(m))) return "quota_exhausted";
  if (s.includes("429") || s.includes("too many")) return "rate_limited";
  return "other";
}

/** Only a genuine rate limit is worth another attempt. */
export function isRetryableRpcFailure(e: unknown): boolean {
  return classifyRpcFailure(e) === "rate_limited";
}

export function isQuotaExhausted(e: unknown): boolean {
  return classifyRpcFailure(e) === "quota_exhausted";
}

/**
 * Thrown to unwind the remaining work in a polling cycle once the allowance is
 * gone. Carries the source name so the caller can label its metric.
 */
export class QuotaExhaustedError extends Error {
  readonly source: string;
  constructor(source: string, cause: unknown) {
    super(`${source}: RPC quota exhausted (${String(cause).slice(0, 200)})`);
    this.name = "QuotaExhaustedError";
    this.source = source;
  }
}
