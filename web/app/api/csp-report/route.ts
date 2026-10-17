/**
 * POST /api/csp-report
 *
 * Receives Content Security Policy violation reports from the browser.
 * The browser sends these when a resource is blocked by the active
 * Content-Security-Policy (or Content-Security-Policy-Report-Only) header
 * and a `report-uri /api/csp-report` directive is present.
 *
 * Content-Type variants the browser may send:
 *   - application/csp-report  (older browsers, report-uri directive)
 *   - application/reports+json  (newer Reporting API / report-to directive)
 *
 * Both arrive as JSON. We parse defensively and log a concise one-liner so
 * violations are searchable in Vercel's runtime logs without storing PII.
 *
 * Returns 204 No Content on both success and parse failure — the browser does
 * not retry on non-2xx, so returning an error status would suppress subsequent
 * reports from the same session.
 */

import type { NextRequest } from "next/server";

/** Shape of a report-uri CSP report (application/csp-report). */
interface CspReportBody {
  "csp-report"?: {
    "violated-directive"?: string;
    "effective-directive"?: string;
    "blocked-uri"?: string;
    "document-uri"?: string;
    "source-file"?: string;
    "line-number"?: number;
    "column-number"?: number;
    "script-sample"?: string;
    disposition?: string;
  };
}

/** Shape of a Reporting API report (application/reports+json). */
interface ReportingApiReport {
  type?: string;
  body?: {
    blockedURL?: string;
    documentURL?: string;
    effectiveDirective?: string;
    violatedDirective?: string;
    sourceFile?: string;
    lineNumber?: number;
    columnNumber?: number;
    disposition?: string;
    sample?: string;
  };
}

/** Maximum body size we are willing to read and parse (64 KB). */
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: NextRequest): Promise<Response> {
  try {
    // FIX 3: Guard against oversized bodies before reading (DoS / log-spam).
    // Browsers send compact JSON violation objects; anything over 64 KB is
    // almost certainly malformed or adversarial. We check Content-Length first
    // (fast path, no streaming) and fall back to a post-read length check so
    // we also catch chunked transfers without Content-Length.
    const contentLength = request.headers.get("content-length");
    if (
      contentLength !== null &&
      parseInt(contentLength, 10) > MAX_BODY_BYTES
    ) {
      return new Response(null, { status: 204 });
    }

    const text = await request.text();
    if (!text) {
      // Empty body — nothing to log; still acknowledge
      return new Response(null, { status: 204 });
    }

    // Post-read size check for chunked transfers without Content-Length.
    if (text.length > MAX_BODY_BYTES) {
      return new Response(null, { status: 204 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Malformed JSON — log raw snippet and return 204
      console.warn(
        "[csp-report] Received malformed CSP report (JSON parse failed):",
        text.slice(0, 200),
      );
      return new Response(null, { status: 204 });
    }

    // Normalize across report-uri (application/csp-report) and Reporting API
    // (application/reports+json, which is an array of report objects).
    const summaries: string[] = [];

    if (Array.isArray(parsed)) {
      // Reporting API format: array of report objects
      for (const item of parsed as ReportingApiReport[]) {
        const body = item?.body;
        summaries.push(
          `directive=${body?.effectiveDirective ?? body?.violatedDirective ?? "unknown"} ` +
            `blocked=${body?.blockedURL ?? "unknown"} ` +
            `document=${body?.documentURL ?? "unknown"} ` +
            `disposition=${body?.disposition ?? "unknown"}`,
        );
      }
    } else if (
      typeof parsed === "object" &&
      parsed !== null &&
      "csp-report" in parsed
    ) {
      // report-uri format: single { "csp-report": { ... } }
      const report = (parsed as CspReportBody)["csp-report"];
      summaries.push(
        `directive=${report?.["effective-directive"] ?? report?.["violated-directive"] ?? "unknown"} ` +
          `blocked=${report?.["blocked-uri"] ?? "unknown"} ` +
          `document=${report?.["document-uri"] ?? "unknown"} ` +
          `disposition=${report?.["disposition"] ?? "unknown"}`,
      );
    } else {
      // Unexpected shape — log truncated raw payload for debugging
      summaries.push(
        `(unknown shape) raw=${JSON.stringify(parsed).slice(0, 200)}`,
      );
    }

    // FIX 2: Use console.warn only — no Sentry capture.
    // During the Report-Only observation window all we need is visibility in
    // Vercel function logs. Sending every violation to Sentry would burn the
    // 5 k/mo free quota instantly (prior Sentry-quota-flood incident 2026-06-18).
    // Re-evaluate if/when switching to enforcing mode and violation volume drops.
    for (const summary of summaries) {
      console.warn("[csp-report]", summary);
    }
  } catch (err) {
    // Top-level catch: even if request.text() throws, we must return 204
    console.warn("[csp-report] Unexpected error processing report:", err);
  }

  return new Response(null, { status: 204 });
}
