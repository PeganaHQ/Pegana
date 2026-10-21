// Composer entry-point for ADR-0011 middleware (call-log + rate-limit).
//
// Usage in server.ts:
//   mcp.registerTool(
//     toolDef.name,
//     { ... },
//     withRateLimit(toolDef.name, withCallLog(toolDef.name, toolDef.handler)),
//   );
//
// The composition order is intentional: `withRateLimit` is the outer
// gate so over-budget calls short-circuit before the handler runs, but
// the rate-limiter itself logs the 429 row directly via `logCall` so
// abuse is still visible in `mcp_call_log` even when `withCallLog`
// never sees the call.

import { extractFingerprint } from "@/middleware/fingerprint";
import { checkRateLimit, RATE_LIMIT_PER_MIN } from "@/middleware/rate-limit";
import { logCall } from "@/middleware/call-log";
import { pool } from "@/db";
import type { Pool } from "pg";

type AnyHandler<Args, R> = (args: Args, extra?: unknown) => Promise<R>;

interface ExtraLike {
  requestInfo?: { headers?: Record<string, string | string[] | undefined> };
  _fingerprint?: string;
}

/**
 * Outer middleware: extracts the caller fingerprint (hashed client IP) from
 * the incoming HTTP headers (via the MCP SDK's RequestHandlerExtra.requestInfo)
 * and enforces the 100 calls/min cap from ADR-0011.
 *
 * Side-effects:
 *   * Decorates `extra._fingerprint` so downstream wrappers (notably
 *     withCallLog) reuse the same value without recomputing.
 *   * On reject: emits a `429` row to `mcp_call_log` directly (since
 *     withCallLog never runs) and returns an MCP `isError: true` payload.
 */
export function withRateLimit<Args extends Record<string, unknown>, R>(
  toolName: string,
  handler: AnyHandler<Args, R>,
  poolFn: () => Pool = pool,
): AnyHandler<Args, R> {
  return async (args, extra) => {
    const e = (extra ?? {}) as ExtraLike;
    // Keyed on the proxy-reported client IP only: no client-supplied value
    // (e.g. an unverified X-PAYMENT header) may choose the bucket.
    const fingerprint = extractFingerprint(e.requestInfo?.headers);
    e._fingerprint = fingerprint;

    if (!checkRateLimit(fingerprint)) {
      // Log the 429 so abuse shows in telemetry. The withCallLog wrapper
      // doesn't run when we short-circuit here, so write the row inline.
      void logCall(
        poolFn,
        toolName,
        fingerprint,
        extractAlertIdFromArgs(args),
        429,
      ).catch(() => {});
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "rate_limited",
              limit_per_min: RATE_LIMIT_PER_MIN,
              retry_after_seconds: 60,
            }),
          },
        ],
        isError: true,
      } as unknown as R;
    }

    return handler(args, e);
  };
}

function extractAlertIdFromArgs(args: Record<string, unknown>): string | null {
  const v = args.alert_id;
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? v
    : null;
}

export { withCallLog } from "@/middleware/call-log";
export { RATE_LIMIT_PER_MIN } from "@/middleware/rate-limit";
