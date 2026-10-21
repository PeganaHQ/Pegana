import { isRateLimited } from "./client";
import { rateLimitWaitMs } from "./freshness";

/** Max automatic retries for one failing SWR key (matches the old default). */
export const ERROR_RETRY_COUNT = 3;
const BASE_RETRY_MS = 5_000;
/** Fallback wait on a 429 that carries no usable Retry-After (the API window). */
const RATE_LIMIT_FALLBACK_SEC = 60;

/**
 * How long SWR should wait before retrying a failed fetch, or `null` to stop.
 *
 * - 404 is a definitive answer (unknown symbol), so retrying only spends the
 *   visitor's shared per-IP budget (240 a minute in production).
 * - 429 waits for the tab-wide gate in lib/api/freshness.ts (Retry-After,
 *   exponential on repeated 429s, jittered) and never less than Retry-After.
 *   The old fixed 5s retry fired more requests into a window that was already
 *   exhausted, which kept the IP rate-limited.
 * - Anything else backs off exponentially from 5s.
 */
export function errorRetryDelayMs(
  err: unknown,
  retryCount: number,
  gateWaitMs: number = rateLimitWaitMs(),
): number | null {
  if (retryCount > ERROR_RETRY_COUNT) return null;
  const status = (err as { status?: number } | null | undefined)?.status;
  if (status === 404) return null;
  if (isRateLimited(err)) {
    const sec = (err as { retryAfterSec?: number }).retryAfterSec;
    const fromHeader =
      typeof sec === "number" && Number.isFinite(sec) && sec > 0
        ? sec * 1000
        : RATE_LIMIT_FALLBACK_SEC * 1000;
    // Small jitter so every hook on the page does not fire on the same tick.
    return (
      Math.max(fromHeader, gateWaitMs) + Math.floor(Math.random() * 1000)
    );
  }
  return BASE_RETRY_MS * 2 ** Math.max(0, retryCount - 1);
}
