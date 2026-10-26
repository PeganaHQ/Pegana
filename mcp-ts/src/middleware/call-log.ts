// MCP tool-call telemetry middleware (ADR-0011).
//
// Every wrapped tool invocation writes a row to `mcp_call_log` so we
// have a usage signal for free tools (verify_alert) on par with the
// on-chain settlement record paid tools generate. Schema in
// migrations/0036_mcp_call_log.sql.
//
// Critical guarantee: telemetry failure must NEVER break tool serving.
// All log writes are fire-and-forget with the error swallowed (logged
// to stderr only). The tool's own success/error semantics flow through
// untouched.

import type { Pool } from "pg";
import { pool } from "@/db";

type AnyHandler<Args, R> = (args: Args, extra?: unknown) => Promise<R>;

interface ToolResultLike {
  isError?: boolean;
}

/**
 * Wrap a tool handler so every invocation logs to `mcp_call_log`.
 * Logging is best-effort: a DB failure NEVER propagates to the caller.
 *
 * Response status convention:
 *   200 — handler resolved with isError !== true
 *   500 — handler resolved with isError === true, or threw
 *   429 — supplied by the rate-limit wrapper (see status param)
 *
 * The wrapper composes cleanly with `withRateLimit`. Recommended order
 * is `withRateLimit(withCallLog(handler))` so rate-limited rejections
 * also get logged (with response_status = 429) and we see the abuse
 * pattern in telemetry.
 */
export function withCallLog<Args extends Record<string, unknown>, R>(
  toolName: string,
  handler: AnyHandler<Args, R>,
  poolFn: () => Pool = pool,
): AnyHandler<Args, R> {
  return async (args, extra) => {
    const fingerprint = pickFingerprint(extra);
    let responseStatus = 200;
    let result: R;
    try {
      result = await handler(args, extra);
    } catch (e) {
      // Log first so the abuse signal is preserved, then re-throw so
      // the tool surface still errors out cleanly to the MCP caller.
      void logCall(
        poolFn,
        toolName,
        fingerprint,
        extractAlertId(args),
        500,
      ).catch(() => {});
      throw e;
    }
    if (
      typeof result === "object" &&
      result !== null &&
      (result as ToolResultLike).isError === true
    ) {
      responseStatus = 500;
    }
    void logCall(
      poolFn,
      toolName,
      fingerprint,
      extractAlertId(args),
      responseStatus,
    ).catch(() => {});
    return result;
  };
}

/**
 * Direct insert helper, exported so the rate-limit wrapper can log
 * 429s without going through `withCallLog` (whose handler already
 * short-circuited).
 */
export async function logCall(
  poolFn: () => Pool,
  toolName: string,
  fingerprint: string | undefined,
  alertId: string | null,
  responseStatus: number,
): Promise<void> {
  try {
    await poolFn().query(
      "INSERT INTO mcp_call_log (tool_name, agent_fingerprint, alert_id, response_status) VALUES ($1, $2, $3, $4)",
      [toolName, fingerprint ?? null, alertId, responseStatus],
    );
  } catch (e) {
    // Telemetry failure MUST NOT break tool serving. Log + drop.
    console.warn("[mcp_call_log] insert failed:", e);
  }
}

function extractAlertId(args: Record<string, unknown>): string | null {
  // Only verify_alert references a single alert; other tools always
  // log null. UUID-shaped check guards against any future tool reusing
  // `alert_id` for a non-UUID field.
  const v = args.alert_id;
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? v
    : null;
}

function pickFingerprint(extra: unknown): string | undefined {
  // The MCP SDK passes a `RequestHandlerExtra` with a `requestInfo`
  // field carrying the HTTP headers from the transport. We do a
  // duck-typed walk so this stays defensive against SDK shape changes.
  if (
    extra &&
    typeof extra === "object" &&
    "_fingerprint" in extra &&
    typeof (extra as { _fingerprint: unknown })._fingerprint === "string"
  ) {
    return (extra as { _fingerprint: string })._fingerprint;
  }
  return undefined;
}
