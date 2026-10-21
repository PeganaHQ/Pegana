// GET helper for the tools that proxy api-rs (loop exposure, simulate,
// verify, methodology class fallback).
//
// api-rs rate-limits per client IP, keyed on the first X-Forwarded-For entry
// (crates/api-rs/src/rate_limit.rs). When PEGANA_API points at the public
// https://api.pegana.xyz, Caddy overwrites X-Forwarded-For with the MCP
// container's egress IP, so EVERY MCP user shares one 60/min bucket and a
// burst from one agent 429s everybody (R1 audit idx 86). Pointing PEGANA_API
// at the internal http://api:8080 and forwarding the MCP caller's IP (taken
// from the Caddy-set header on the MCP request, so it cannot be spoofed)
// gives each caller its own upstream bucket. Against the public URL the
// forwarded header is simply overwritten by Caddy, so this is always safe.

import { clientIp } from "@/middleware/fingerprint";
import type { IsomorphicHeaders } from "@modelcontextprotocol/sdk/types.js";

const UPSTREAM_TIMEOUT_MS = 10_000;

interface ExtraWithHeaders {
  requestInfo?: { headers?: IsomorphicHeaders };
}

/** Headers to send upstream on behalf of the MCP caller described by `extra`. */
export function upstreamHeaders(extra: unknown): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  const ip = clientIp((extra as ExtraWithHeaders | undefined)?.requestInfo?.headers);
  if (ip) headers["x-forwarded-for"] = ip;
  return headers;
}

export function upstreamGet(url: string, extra?: unknown): Promise<Response> {
  return fetch(url, {
    method: "GET",
    headers: upstreamHeaders(extra),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

/**
 * Seconds from an upstream `Retry-After` header (delta-seconds form; api-rs
 * always sends that form). Undefined when absent or not a number.
 */
export function retryAfterSeconds(resp: Pick<Response, "headers">): number | undefined {
  const raw = resp.headers?.get?.("retry-after");
  if (raw == null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : undefined;
}

/**
 * isError text for a non-2xx upstream reply. A 429 is reported in the same
 * JSON shape as this server's own rate-limit error (@/middleware), with the
 * upstream Retry-After as `retry_after_seconds`, so an agent can back off
 * the same way whichever limiter tripped (R2 audit idx 23d).
 */
export function upstreamFailureText(what: string, resp: Pick<Response, "status" | "headers">): string {
  if (resp.status === 429) {
    const retry = retryAfterSeconds(resp);
    return JSON.stringify({
      error: "rate_limited",
      upstream: what,
      ...(retry !== undefined ? { retry_after_seconds: retry } : {}),
    });
  }
  return `Error: ${what} failed (HTTP ${resp.status}).`;
}
