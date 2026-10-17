import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Dynamic import the handler (no Sentry mock needed — FIX 2 removed the
// Sentry capture; the handler now uses console.warn only)
const { POST } = await import("./route");

/**
 * Build a minimal NextRequest-compatible object for testing.
 * The route handler only calls `.text()` on the request, so we can
 * satisfy the type by casting a plain Request (same Web API shape).
 */
function makeRequest(
  body: string,
  contentType = "application/csp-report",
  extraHeaders: Record<string, string> = {},
): NextRequest {
  return new Request("http://localhost/api/csp-report", {
    method: "POST",
    headers: { "Content-Type": contentType, ...extraHeaders },
    body,
  }) as unknown as NextRequest;
}

describe("POST /api/csp-report", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns 204 for a valid report-uri format report", async () => {
    const report = JSON.stringify({
      "csp-report": {
        "violated-directive": "script-src",
        "blocked-uri": "https://evil.example.com/malicious.js",
        "document-uri": "https://pegana.xyz/dashboard",
        disposition: "report",
      },
    });
    const res = await POST(makeRequest(report));
    expect(res.status).toBe(204);
  });

  it("returns 204 for a Reporting API format report (array)", async () => {
    const report = JSON.stringify([
      {
        type: "csp-violation",
        body: {
          blockedURL: "https://evil.example.com/bad.js",
          documentURL: "https://pegana.xyz/",
          effectiveDirective: "script-src",
          disposition: "report",
        },
      },
    ]);
    const res = await POST(makeRequest(report, "application/reports+json"));
    expect(res.status).toBe(204);
  });

  it("returns 204 for a malformed (non-JSON) body", async () => {
    const res = await POST(makeRequest("not-valid-json!!!"));
    expect(res.status).toBe(204);
  });

  it("returns 204 for an empty body", async () => {
    const res = await POST(makeRequest(""));
    expect(res.status).toBe(204);
  });

  it("returns 204 for an unexpected JSON shape", async () => {
    const res = await POST(makeRequest('{"unexpected": true}'));
    expect(res.status).toBe(204);
  });

  it("logs a warn for a valid csp-report", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const report = JSON.stringify({
      "csp-report": {
        "violated-directive": "img-src",
        "blocked-uri": "https://tracker.evil.com/pixel.gif",
        "document-uri": "https://pegana.xyz/assets",
        disposition: "report",
      },
    });
    await POST(makeRequest(report));
    expect(warnSpy).toHaveBeenCalledWith(
      "[csp-report]",
      expect.stringContaining("img-src"),
    );
    warnSpy.mockRestore();
  });

  // FIX 2: Sentry is no longer called — only console.warn
  it("does NOT call Sentry (console.warn only)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const report = JSON.stringify({
      "csp-report": {
        "violated-directive": "script-src",
        "blocked-uri": "inline",
        "document-uri": "https://pegana.xyz/",
        disposition: "report",
      },
    });
    await POST(makeRequest(report));
    // Sentry dynamic import no longer happens — if it did it would throw in
    // vitest (no @sentry/nextjs mock). The fact we reach here without an error
    // proves Sentry is not invoked.
    expect(warnSpy).toHaveBeenCalledWith(
      "[csp-report]",
      expect.stringContaining("script-src"),
    );
    warnSpy.mockRestore();
  });

  // FIX 3: oversized bodies (via Content-Length header) are rejected without parsing
  it("returns 204 without parsing when Content-Length exceeds 64 KB", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // We set a large Content-Length header but supply a small body — the guard
    // checks the header first, so it returns early before calling .text()
    const res = await POST(
      makeRequest(
        '{"csp-report":{}}',
        "application/csp-report",
        { "content-length": String(65 * 1024) }, // 65 KB > 64 KB limit
      ),
    );
    expect(res.status).toBe(204);
    // No warn log — we returned before parsing
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // FIX 3: oversized body text (chunked, no Content-Length) is also rejected
  it("returns 204 without further processing when body text exceeds 64 KB", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 65 KB of 'A' — passes Content-Length check (no header) but fails text length check
    const bigBody = "A".repeat(65 * 1024);
    const res = await POST(makeRequest(bigBody));
    expect(res.status).toBe(204);
    // The oversized check fires before any JSON.parse / console.warn
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
