// Caller fingerprint for ADR-0011 telemetry + rate limiting.
//
// The ONLY identity is the originating client IP. Caddy sets
// `X-Forwarded-For` on every proxied request and ignores any value the client
// sent (Caddy 2 only trusts incoming X-Forwarded-* from configured trusted
// proxies, and none are configured), so its first entry is the real peer.
// Local dev has no proxy, so we fall back to `X-Real-IP` and finally to the
// shared `anonymous` bucket.
//
// R1 audit idx 16: this used to look at an x402 `X-PAYMENT` header (and the
// `_meta["x402/payment"]` field) FIRST and hash it without verifying any
// payment, so every random header value got a fresh 100/min bucket and the
// limit could be bypassed at will. Every tool is free and nothing verifies a
// payment, so no client-supplied value may influence the bucket key. If a
// paid tier ever returns, fingerprint the payer only AFTER the facilitator
// has verified the payment.
//
// Why a hash instead of the raw IP:
//   * mcp_call_log stores fingerprints; we don't want to log raw IPs.
//   * Stable, short identifier across calls from the same agent.
//
// The hash is keyed by a process-local salt so two operators reading
// the same log can't trivially correlate fingerprints — call-log rows
// are operator-only data, not a public namespace.

import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { IsomorphicHeaders } from "@modelcontextprotocol/sdk/types.js";

// Process-local salt, generated once at module load. Restarts rotate
// the salt — fine, because fingerprints only need to be stable within
// a single rate-limit window (60s).
const SALT = randomBytes(16).toString("hex");

function headerValue(
  headers: IsomorphicHeaders | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  // Headers are case-insensitive per RFC; the MCP SDK preserves the
  // original casing as written by the HTTP transport. Probe lowercase
  // first (Node's http2 + Bun normalize) then the canonical form.
  const lower = headers[name.toLowerCase()];
  const exact = headers[name];
  const raw = lower ?? exact;
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * The originating client IP as the proxy reported it, or `undefined` when no
 * proxy header is present (local dev without a proxy).
 */
export function clientIp(
  headers: IsomorphicHeaders | undefined,
): string | undefined {
  const xff = headerValue(headers, "x-forwarded-for");
  if (xff) {
    // Comma-separated list, originating client first.
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headerValue(headers, "x-real-ip")?.trim();
  return realIp || undefined;
}

/**
 * Derive a stable, short fingerprint for an MCP caller from its IP. Returns
 * `undefined` if the request carries no proxy IP header at all (callers then
 * share the `anonymous` bucket).
 */
export function extractFingerprint(
  headers: IsomorphicHeaders | undefined,
): string | undefined {
  const ip = clientIp(headers);
  return ip ? hash(`ip:${rateLimitIp(ip)}`) : undefined;
}

/** Group IPv6 callers by their /64 network before hashing the bucket key. */
export function rateLimitIp(ip: string): string {
  const bare = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  if (isIP(bare) !== 6) return bare;
  let canonical: string;
  try {
    canonical = new URL(`http://[${bare}]/`).hostname.slice(1, -1);
  } catch {
    // A zone id (fe80::1%eth0) is not valid in a URL host: drop it and retry.
    const noZone = bare.split("%")[0]!;
    try {
      canonical = new URL(`http://[${noZone}]/`).hostname.slice(1, -1);
    } catch {
      return bare;
    }
  }
  const [left, right] = canonical.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  const groups = canonical.includes("::")
    ? [...leftParts, ...Array(8 - leftParts.length - rightParts.length).fill("0"), ...rightParts]
    : leftParts;
  // IPv4-mapped (::ffff:a.b.c.d): bucket by the embedded IPv4, not the shared
  // ::/64, or every mapped caller lands in one bucket.
  if (
    groups.length === 8 &&
    groups.slice(0, 5).every((g) => parseInt(g, 16) === 0) &&
    parseInt(groups[5]!, 16) === 0xffff
  ) {
    const hi = parseInt(groups[6]!, 16);
    const lo = parseInt(groups[7]!, 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return `${groups.slice(0, 4).map((group) => group.padStart(4, "0")).join(":")}::/64`;
}

function hash(input: string): string {
  return createHash("sha256")
    .update(SALT)
    .update(":")
    .update(input)
    .digest("hex")
    .slice(0, 16); // 16 hex chars = 64 bits — plenty for in-memory bucketing.
}
