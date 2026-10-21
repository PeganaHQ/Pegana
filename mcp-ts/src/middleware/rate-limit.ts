// Per-agent rate limiters for the MCP endpoint (ADR-0011).
//
// Two independent buckets per caller, both keyed on the agent fingerprint
// (the hashed client IP; see middleware/fingerprint.ts):
//
//   * Tool calls: 100 calls/min, enforced by withRateLimit around each tool.
//     Mirrors the in-memory window in crates/api-rs/src/rate_limit.rs; same
//     rationale (single VPS, sub-1k QPS peak, lock contention negligible).
//   * JSON-RPC messages: 300 messages/min, enforced in the HTTP transport
//     BEFORE the SDK sees the request. Every message counts, including each
//     entry of a batch, `initialize`, `tools/list`, notifications and calls
//     that fail input validation (R3 audit SEC-R3-03: those used to be
//     free). A tools/call is counted in both buckets; the message budget is
//     3x the tool budget so a client at the tool limit still has room for
//     its handshake and listings.
//
// v1.5 will share a Redis token bucket once horizontal scaling matters,
// at which point this and api-rs converge on one implementation.

const WINDOW_MS = 60_000;
const LIMIT_PER_AGENT_PER_MIN = 100;
const MESSAGE_LIMIT_PER_AGENT_PER_MIN = 300;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();
const messageBuckets = new Map<string, Bucket>();

function consume(
  map: Map<string, Bucket>,
  fingerprint: string | undefined,
  cost: number,
  limit: number,
): boolean {
  const key = fingerprint ?? "anonymous";
  const now = Date.now();
  let b = map.get(key);
  if (!b || now - b.windowStart > WINDOW_MS) {
    b = { count: 0, windowStart: now };
    map.set(key, b);
  }
  b.count += cost;
  return b.count <= limit;
}

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
  return consume(buckets, fingerprint, 1, LIMIT_PER_AGENT_PER_MIN);
}

/**
 * Charge `count` JSON-RPC messages (one per batch entry) to the caller's
 * message bucket. Returns `false` once the caller is over
 * `MESSAGE_LIMIT_PER_AGENT_PER_MIN` in the current window; rejected
 * messages still count, so a flood cannot keep probing for free.
 */
export function checkMessageRateLimit(
  fingerprint: string | undefined,
  count: number,
): boolean {
  return consume(
    messageBuckets,
    fingerprint,
    Math.max(1, Math.floor(count)),
    MESSAGE_LIMIT_PER_AGENT_PER_MIN,
  );
}

// Bounded memory under NAT / exit-pool churn — drop buckets older than
// 2× the window so the map can't grow without limit. `.unref()` so the
// timer never blocks process exit (matters for test runs and graceful
// shutdown).
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const map of [buckets, messageBuckets]) {
    for (const [k, b] of map) {
      if (now - b.windowStart > WINDOW_MS * 2) {
        map.delete(k);
      }
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
  messageBuckets.clear();
}

export const RATE_LIMIT_PER_MIN = LIMIT_PER_AGENT_PER_MIN;
export const MESSAGE_RATE_LIMIT_PER_MIN = MESSAGE_LIMIT_PER_AGENT_PER_MIN;
