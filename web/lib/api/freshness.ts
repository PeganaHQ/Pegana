// Browser-side request health for the public API: one shared 429 gate plus a
// tiny "when did data last land" store that the UI reads for its freshness
// notice.
//
// Why a gate: the API allows a fixed number of requests a minute per IP, and
// offices, carrier NAT and multi-tab readers share that IP. Once one request
// gets a 429, every other hook on the page would otherwise fire into the same
// exhausted window (each with its own retry), which keeps the IP limited. The
// gate makes the whole tab wait out Retry-After (plus jitter, growing
// exponentially on repeated 429s) without touching the network, and SWR keeps
// rendering the last good data meanwhile.
//
// Server-side fetches (SSR, with the x-pegana-ssr-token bypass) never use the
// gate: module state on the server is shared by every visitor, so `client.ts`
// only calls in here when `window` exists.

export type FailureKind = "rate_limited" | "server" | "network";

export interface FreshnessSnapshot {
  /** Epoch ms of the most recent successful API response in this tab. */
  lastSuccessAt: number | null;
  /** Epoch ms when the store was created (the page's first API activity). */
  startedAt: number;
  /** Current failure, cleared by the next success. */
  failureKind: FailureKind | null;
  /** Epoch ms of the first failure since the last success. */
  failingSince: number | null;
}

/** Floor for the exponential wait on repeated 429s. */
const RATE_LIMIT_BASE_MS = 15_000;
/** Ceiling for any single 429 wait. */
const RATE_LIMIT_MAX_MS = 5 * 60_000;
/** Wait used when a 429 carries no usable Retry-After (one API window). */
const RATE_LIMIT_FALLBACK_MS = 60_000;
/** Freshness notices stay hidden until data has been stale this long. */
export const PAUSED_NOTICE_AFTER_MS = 60_000;

let snapshot: FreshnessSnapshot = {
  lastSuccessAt: null,
  startedAt: Date.now(),
  failureKind: null,
  failingSince: null,
};
let blockedUntil = 0;
let consecutive429 = 0;
const listeners = new Set<() => void>();

function emit(next: FreshnessSnapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

export function subscribeFreshness(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFreshnessSnapshot(): FreshnessSnapshot {
  return snapshot;
}

export function recordApiSuccess(now: number = Date.now()): void {
  consecutive429 = 0;
  blockedUntil = 0;
  emit({ ...snapshot, lastSuccessAt: now, failureKind: null, failingSince: null });
}

export function recordApiFailure(
  kind: FailureKind,
  now: number = Date.now(),
): void {
  if (snapshot.failureKind === kind) return;
  emit({
    ...snapshot,
    failureKind: kind,
    failingSince: snapshot.failingSince ?? now,
  });
}

/**
 * Register a 429 and return how long (ms) the tab must now wait before the
 * next request. Waits max(Retry-After, 15s * 2^(n-1)) for the n-th 429 in a
 * row, capped at 5 min, plus up to 20% jitter (max 5s) so tabs behind one IP
 * do not all come back on the same tick. The Pegana API always sends
 * Retry-After: 60, so in practice the schedule is 60s, 60s, 60s, 120s, 240s,
 * then 300s.
 */
export function noteRateLimited(
  retryAfterSec: number | undefined,
  now: number = Date.now(),
  random: () => number = Math.random,
): number {
  consecutive429 += 1;
  const fromHeader =
    typeof retryAfterSec === "number" &&
    Number.isFinite(retryAfterSec) &&
    retryAfterSec > 0
      ? retryAfterSec * 1000
      : RATE_LIMIT_FALLBACK_MS;
  const exponential = RATE_LIMIT_BASE_MS * 2 ** (consecutive429 - 1);
  const wait = Math.min(RATE_LIMIT_MAX_MS, Math.max(fromHeader, exponential));
  const jitter = Math.floor(random() * Math.min(5_000, wait * 0.2));
  blockedUntil = Math.max(blockedUntil, now + wait + jitter);
  recordApiFailure("rate_limited", now);
  return blockedUntil - now;
}

/** Remaining ms of the current 429 wait, or 0 when requests may go out. */
export function rateLimitWaitMs(now: number = Date.now()): number {
  return Math.max(0, blockedUntil - now);
}

/**
 * True when the visitor should be told live updates are paused: requests have
 * been failing for more than 60s (counted from the FIRST failure, not from
 * the last success, so a slow poll cadence cannot make one failed poll look
 * like a minute of failure). A single failed poll, or a 429 that clears
 * within a minute, shows nothing.
 */
export function isLiveUpdatesPaused(
  s: FreshnessSnapshot,
  now: number = Date.now(),
  thresholdMs: number = PAUSED_NOTICE_AFTER_MS,
): boolean {
  if (s.failureKind == null) return false;
  const since = Math.max(
    s.lastSuccessAt ?? s.startedAt,
    s.failingSince ?? s.startedAt,
  );
  return now - since > thresholdMs;
}

/** Test hook: start every test from a clean tab. */
export function __resetFreshnessForTests(now: number = Date.now()): void {
  blockedUntil = 0;
  consecutive429 = 0;
  snapshot = {
    lastSuccessAt: null,
    startedAt: now,
    failureKind: null,
    failingSince: null,
  };
  for (const l of listeners) l();
}
