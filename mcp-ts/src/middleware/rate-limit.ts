// Per-agent rate limiter for MCP tool calls (ADR-0011).
//
// 100 calls/min per agent fingerprint (paid: hashed x402 payment header;
// free: hashed source IP — see middleware/fingerprint.ts). Mirrors the
// in-memory sliding window in crates/api-rs/src/rate_limit.rs; same
// rationale (single VPS, sub-1k QPS peak, lock contention negligible).
//
// v1.5 will share a Redis token bucket once horizontal scaling matters,
// at which point this and api-rs converge on one implementation.

const WINDOW_MS = 60_000;
const LIMIT_PER_AGENT_PER_MIN = 100;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Check + increment the per-agent counter. Returns `true` if the call
 * is allowed, `false` if the agent has exceeded `LIMIT_PER_AGENT_PER_MIN`
 * within the current sliding window.
 *
 * Anonymous callers (no fingerprint extracted) share one bucket keyed
 * by the literal "anonymous" so we still cap pathological cases — the
 * collision is intentional and acceptable until v1.5 brings stricter
 * identification.
 */
export function checkRateLimit(fingerprint: string | undefined): boolean {
  const key = fingerprint ?? "anonymous";
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.windowStart > WINDOW_MS) {
    b = { count: 0, windowStart: now };
    buckets.set(key, b);
  }
  b.count += 1;
  return b.count <= LIMIT_PER_AGENT_PER_MIN;
}

// Bounded memory under NAT / exit-pool churn — drop buckets older than
// 2× the window so the map can't grow without limit. `.unref()` so the
// timer never blocks process exit (matters for test runs and graceful
// shutdown).
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.windowStart > WINDOW_MS * 2) {
      buckets.delete(k);
    }
  }
}, WINDOW_MS);
sweeper.unref?.();

/**
 * Test helper: clear the in-memory state so unit tests start from a
 * known baseline. Not exported as part of the public middleware API.
 */
export function _resetForTests(): void {
  buckets.clear();
}

export const RATE_LIMIT_PER_MIN = LIMIT_PER_AGENT_PER_MIN;
