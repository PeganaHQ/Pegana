import { afterEach, describe, expect, it, vi } from "vitest";
import { upstreamHeaders } from "@/shared/upstream";

// R1 audit idx 86: proxied calls must carry the MCP caller's IP so api-rs
// (per-IP limiter keyed on X-Forwarded-For) buckets each caller separately
// when PEGANA_API points at the internal network.

describe("upstreamHeaders", () => {
  it("forwards the first X-Forwarded-For entry of the MCP request", () => {
    expect(
      upstreamHeaders({
        requestInfo: { headers: { "x-forwarded-for": "198.51.100.4, 172.18.0.5" } },
      }),
    ).toEqual({ accept: "application/json", "x-forwarded-for": "198.51.100.4" });
  });

  it("sends no X-Forwarded-For when the MCP request had none", () => {
    expect(upstreamHeaders(undefined)).toEqual({ accept: "application/json" });
    expect(upstreamHeaders({ requestInfo: { headers: {} } })).toEqual({
      accept: "application/json",
    });
  });
});

describe("proxy tools forward the caller IP", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("get_loop_exposure passes the SDK extra through to the upstream request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ asset: "vSOL" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { getLoopExposureTool } = await import("@/tools/get-loop-exposure");
    await getLoopExposureTool.handler(
      { symbol: "vSOL" },
      { requestInfo: { headers: { "x-forwarded-for": "203.0.113.50" } } },
    );
    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(init.headers["x-forwarded-for"]).toBe("203.0.113.50");
  });
});

// R2 audit idx 23d: a proxied 429 surfaced as "simulate-depeg failed (HTTP
// 429)." with no back-off hint, while the MCP limiter's own error carries
// retry_after_seconds.
describe("proxied 429 carries the upstream Retry-After", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function rateLimited(retryAfter: string | null) {
    return vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers(retryAfter === null ? {} : { "retry-after": retryAfter }),
      text: async () => '{"error":"rate_limited"}',
    }) as unknown as typeof fetch;
  }

  it("simulate_depeg_impact and get_loop_exposure report retry_after_seconds", async () => {
    const { simulateDepegTool } = await import("@/tools/simulate-depeg");
    const { getLoopExposureTool } = await import("@/tools/get-loop-exposure");
    globalThis.fetch = rateLimited("17");
    const sim = await simulateDepegTool.handler({ symbol: "jitoSOL", shock_bps: 500 });
    expect(sim.isError).toBe(true);
    expect(JSON.parse(sim.content[0]!.text)).toEqual({
      error: "rate_limited",
      upstream: "simulate-depeg",
      retry_after_seconds: 17,
    });
    const loop = await getLoopExposureTool.handler({ symbol: "jitoSOL" });
    expect(JSON.parse(loop.content[0]!.text)).toMatchObject({ retry_after_seconds: 17 });
  });

  it("omits retry_after_seconds when the header is absent or not a number", async () => {
    const { upstreamFailureText } = await import("@/shared/upstream");
    expect(JSON.parse(upstreamFailureText("x", { status: 429, headers: new Headers() }))).toEqual({
      error: "rate_limited",
      upstream: "x",
    });
    expect(
      JSON.parse(upstreamFailureText("x", { status: 429, headers: new Headers({ "retry-after": "soon" }) })),
    ).not.toHaveProperty("retry_after_seconds");
    expect(upstreamFailureText("x", { status: 503, headers: new Headers() })).toBe("Error: x failed (HTTP 503).");
  });

  it("verify_alert adds retry_after_seconds to its api_error payload on a 429", async () => {
    const { verifyAlertTool } = await import("@/tools/verify-alert");
    globalThis.fetch = rateLimited("5");
    const res = await verifyAlertTool.handler({ alert_id: "11111111-2222-3333-4444-555555555555" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as { result: Record<string, unknown> }).result).toMatchObject({
      error: "api_error",
      status: 429,
      retry_after_seconds: 5,
    });
  });
});
