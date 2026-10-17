// Unit tests for the verify_alert MCP tool.
//
// The handler is a thin proxy to GET /v1/audit/:alert_id. We stub
// global.fetch (vitest-friendly, no msw dep) to cover the happy path,
// the 404-from-API error path, and to confirm subscribe_peg_events now
// surfaces evidence_url in both content and structuredContent.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ALERT_ID = "11111111-2222-3333-4444-555555555555";

describe("verify_alert", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.PEGANA_API = "https://api.test.local";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns receipt JSON in both content and structuredContent on happy path", async () => {
    const receipt = {
      alert_id: ALERT_ID,
      methodology_version: "v0.1.0",
      inputs: { intrinsic_usd: "1.00", market_usd: "0.9966" },
      computed: { discount: "-0.0034", state: "DEPEG" },
      replay_bundle_url: "https://pegana.xyz/audit/x/replay.tar.gz",
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => receipt,
    }) as unknown as typeof fetch;

    const { verifyAlertTool } = await import("@/tools/verify-alert");
    const res = await verifyAlertTool.handler({ alert_id: ALERT_ID });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `https://api.test.local/v1/audit/${ALERT_ID}`,
      { method: "GET" },
    );
    expect(res.isError).toBeUndefined();
    // Audit C P1: structuredContent is now wrapped under `result` so the
    // outputSchema's top-level shape stays closed for the union.
    expect(res.structuredContent).toEqual({ result: receipt });
    expect(JSON.parse(res.content[0]!.text)).toEqual(receipt);
  });

  it("surfaces 404 from the API as an MCP isError with structured error payload", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '{"error":"not_found"}',
    }) as unknown as typeof fetch;

    const { verifyAlertTool } = await import("@/tools/verify-alert");
    const res = await verifyAlertTool.handler({ alert_id: ALERT_ID });

    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.error).toBe("api_error");
    expect(parsed.status).toBe(404);
    // Audit C P2 #11: error path also populates structuredContent so
    // structuredContent-aware clients don't need to JSON.parse text.
    expect(res.structuredContent).toEqual({
      result: {
        error: "api_error",
        status: 404,
        body: '{"error":"not_found"}',
      },
    });
  });
});

describe("subscribe_peg_events evidence_url", () => {
  it("response events include evidence_url derived from AUDIT_BASE_URL", async () => {
    process.env.AUDIT_BASE_URL = "https://staging.pegana.xyz";

    const eventsPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            asset: "jitoSOL",
            from_state: "PEGGED",
            to_state: "DEPEG",
            discount: "-0.0050",
            ts: 1700000000,
          },
        ],
      }),
    };

    const { handleSubscribePegEvents } = await import(
      "@/tools/subscribe-peg-events"
    );
    const res = await handleSubscribePegEvents(
      {
        symbols: ["jitoSOL"],
        since_ts: 0,
      },
      eventsPool,
    );

    expect(res.structuredContent.count).toBe(1);
    const evt = res.structuredContent.events[0]!;
    expect(evt.evidence_url).toBe(
      "https://staging.pegana.xyz/audit/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    // Mirrors in the text payload as well — both transport channels
    // must carry the new field so old clients reading content.text
    // still see it.
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.events[0].evidence_url).toBe(evt.evidence_url);

    delete process.env.AUDIT_BASE_URL;
  });
});
