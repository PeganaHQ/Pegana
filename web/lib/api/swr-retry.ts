import { isRateLimited } from "./client";

/** Max automatic retries for one failing SWR key (matches the old default). */
export const ERROR_RETRY_COUNT = 3;
const BASE_RETRY_MS = 5_000;
/** Fallback wait on a 429 that carries no usable Retry-After (the API window). */
const RATE_LIMIT_FALLBACK_SEC = 60;

/**
 * How long SWR should wait before retrying a failed fetch, or `null` to stop.
 *
 * - 404 is a definitive answer (unknown symbol), so retrying only spends the
 *   visitor's shared 60/min budget.
 * - 429 honours Retry-After. The old fixed 5s retry fired three more requests
 *   into a window that was already exhausted, which kept the IP rate-limited
 *   and made every page look like an outage.
 * - Anything else backs off exponentially from 5s.
 */
export function errorRetryDelayMs(
  err: unknown,
  retryCount: number,
): number | null {
  if (retryCount > ERROR_RETRY_COUNT) return null;
  const status = (err as { status?: number } | null | undefined)?.status;
  if (status === 404) return null;
  if (isRateLimited(err)) {
    const sec = (err as { retryAfterSec?: number }).retryAfterSec;
    const wait =
      typeof sec === "number" && Number.isFinite(sec) && sec > 0
        ? sec
        : RATE_LIMIT_FALLBACK_SEC;
    // Small jitter so every hook on the page does not fire on the same tick.
    return wait * 1000 + Math.floor(Math.random() * 1000);
  }
  return BASE_RETRY_MS * 2 ** Math.max(0, retryCount - 1);
}
