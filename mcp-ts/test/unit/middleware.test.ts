// Unit tests for the ADR-0011 middleware bundle.
//
// Covers:
//   * Rate limit: kicks in after the 101st call within a window for the
//     same fingerprint; different fingerprints don't share a bucket.
//   * Call log: best-effort — a pool.query that rejects MUST NOT cause
//     the wrapped tool handler to error out to the MCP caller.
//   * 429 path: the rate-limit short-circuit writes a row directly to
//     mcp_call_log (bypassing the call-log wrapper which never runs).

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "pg";

import { withCallLog } from "@/middleware/call-log";
import { withRateLimit } from "@/middleware";
import {
  RATE_LIMIT_PER_MIN,
  _resetForTests,
} from "@/middleware/rate-limit";
import { clientIp, extractFingerprint } from "@/middleware/fingerprint";

function makePool(query: (...args: unknown[]) => Promise<unknown>): () => Pool {
  return () => ({ query } as unknown as Pool);
}

const HEADERS_FROM_IP = (ip: string) => ({
  requestInfo: { headers: { "x-forwarded-for": ip } },
});

describe("withRateLimit", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("allows up to RATE_LIMIT_PER_MIN calls per fingerprint then rejects", async () => {
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });
    const recordedRows: unknown[][] = [];
    const poolFn = makePool(async (...a) => {
      recordedRows.push(a as unknown[]);
      return { rows: [] };
    });
    const wrapped = withRateLimit("dummy", handler, poolFn);

    for (let i = 0; i < RATE_LIMIT_PER_MIN; i++) {
      const r = await wrapped(
        { x: i } as unknown as Record<string, unknown>,
        HEADERS_FROM_IP("203.0.113.5"),
      );
      // Handler succeeded — no isError, no rate_limited body.
      expect((r as { isError?: boolean }).isError).toBeFalsy();
    }
    expect(handler).toHaveBeenCalledTimes(RATE_LIMIT_PER_MIN);

    const overLimit = await wrapped(
      {} as Record<string, unknown>,
      HEADERS_FROM_IP("203.0.113.5"),
    );
    const cast = overLimit as {
      isError: boolean;
      content: { text: string }[];
    };
    expect(cast.isError).toBe(true);
    const body = JSON.parse(cast.content[0]!.text);
    expect(body.error).toBe("rate_limited");
    expect(body.limit_per_min).toBe(RATE_LIMIT_PER_MIN);
    // The handler was NOT invoked for the over-limit call.
    expect(handler).toHaveBeenCalledTimes(RATE_LIMIT_PER_MIN);
  });

  it("buckets per fingerprint — different IPs do not share", async () => {
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });
    const wrapped = withRateLimit(
      "dummy",
      handler,
      makePool(async () => ({ rows: [] })),
    );

    // Exhaust IP A.
    for (let i = 0; i < RATE_LIMIT_PER_MIN; i++) {
      await wrapped(
        {} as Record<string, unknown>,
        HEADERS_FROM_IP("10.0.0.1"),
      );
    }
    const overA = await wrapped(
      {} as Record<string, unknown>,
      HEADERS_FROM_IP("10.0.0.1"),
    );
    expect((overA as { isError?: boolean }).isError).toBe(true);

    // IP B should still pass — independent bucket.
    const okB = await wrapped(
      {} as Record<string, unknown>,
      HEADERS_FROM_IP("10.0.0.2"),
    );
    expect((okB as { isError?: boolean }).isError).toBeFalsy();
  });

  it("logs a 429 row when rate-limited (bypassing withCallLog)", async () => {
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });
    const inserts: unknown[][] = [];
    const wrapped = withRateLimit(
      "verify_alert",
      handler,
      makePool(async (_sql, params) => {
        inserts.push(params as unknown[]);
        return { rows: [] };
      }),
    );

    // Burn the budget.
    for (let i = 0; i < RATE_LIMIT_PER_MIN; i++) {
      await wrapped(
        { alert_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
        HEADERS_FROM_IP("198.51.100.7"),
      );
    }
    await wrapped(
      { alert_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      HEADERS_FROM_IP("198.51.100.7"),
    );

    // Allow the void-promised insert to land.
    await new Promise((r) => setTimeout(r, 10));

    const last = inserts.at(-1);
    expect(last).toBeDefined();
    // Schema: [tool_name, fingerprint, alert_id, response_status]
    expect(last![0]).toBe("verify_alert");
    expect(last![2]).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(last![3]).toBe(429);
  });
});

// ── Fingerprint: client IP only (R1 audit idx 16) ─────────────────
//
// The fingerprint used to prefer an x402 `X-PAYMENT` header and hash it
// without verifying any payment, so a random header value per call minted a
// fresh bucket and bypassed the limit. No client-supplied value may pick the
// bucket now; only the proxy-set client IP does.

describe("extractFingerprint", () => {
  it("ignores X-PAYMENT: a random payment header never changes the bucket", () => {
    const plain = extractFingerprint({ "x-forwarded-for": "203.0.113.9" });
    const withPayment = extractFingerprint({
      "x-forwarded-for": "203.0.113.9",
      "x-payment": "deadbeefcafebabe",
    });
    expect(plain).toBeDefined();
    expect(withPayment).toBe(plain);
  });

  it("uses the first X-Forwarded-For entry, then X-Real-IP", () => {
    expect(
      extractFingerprint({ "x-forwarded-for": "198.51.100.1, 10.0.0.2" }),
    ).toBe(extractFingerprint({ "x-forwarded-for": "198.51.100.1" }));
    expect(extractFingerprint({ "x-real-ip": "198.51.100.1" })).toBe(
      extractFingerprint({ "x-forwarded-for": "198.51.100.1" }),
    );
    expect(clientIp({ "x-forwarded-for": " 198.51.100.1 ,1.1.1.1" })).toBe(
      "198.51.100.1",
    );
  });

  it("returns undefined without any IP header, even with X-PAYMENT", () => {
    expect(extractFingerprint({ "x-payment": "anything" })).toBeUndefined();
    expect(extractFingerprint(undefined)).toBeUndefined();
  });
});

describe("withRateLimit cannot be bypassed with X-PAYMENT", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("keeps rejecting an exhausted IP whatever X-PAYMENT it sends", async () => {
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });
    const wrapped = withRateLimit(
      "ping",
      handler,
      makePool(async () => ({ rows: [] })),
    );
    for (let i = 0; i < RATE_LIMIT_PER_MIN; i++) {
      await wrapped({} as Record<string, unknown>, HEADERS_FROM_IP("192.0.2.7"));
    }
    for (const payment of ["a1b2c3d4", "e5f6a7b8"]) {
      const res = await wrapped({} as Record<string, unknown>, {
        requestInfo: {
          headers: { "x-forwarded-for": "192.0.2.7", "x-payment": payment },
        },
        _meta: { "x402/payment": payment },
      });
      expect((res as { isError?: boolean }).isError).toBe(true);
    }
    expect(handler).toHaveBeenCalledTimes(RATE_LIMIT_PER_MIN);
  });
});

describe("withCallLog", () => {
  it("is best-effort: pool.query throwing must NOT break the handler", async () => {
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { ok: true },
    });
    const exploding = makePool(async () => {
      throw new Error("DB down");
    });
    const wrapped = withCallLog("test_tool", handler, exploding);

    // Should resolve cleanly, the failure to log must be swallowed.
    const res = await wrapped(
      { alert_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      {},
    );
    expect((res as { isError?: boolean }).isError).toBeUndefined();
    expect((res as { content: unknown[] }).content[0]).toEqual({
      type: "text",
      text: "ok",
    });

    // Give the void-promised insert a tick to fail silently.
    await new Promise((r) => setTimeout(r, 10));
  });

  it("inserts 200 for success and 500 when handler returns isError", async () => {
    const inserts: unknown[][] = [];
    const poolFn = makePool(async (_sql, params) => {
      inserts.push(params as unknown[]);
      return { rows: [] };
    });

    const okHandler = vi
      .fn()
      .mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const errHandler = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "bad" }],
      isError: true,
    });

    await withCallLog("ok_tool", okHandler, poolFn)(
      { alert_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      {},
    );
    await withCallLog("err_tool", errHandler, poolFn)(
      { alert_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      {},
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(inserts.length).toBe(2);
    expect(inserts[0]![0]).toBe("ok_tool");
    expect(inserts[0]![3]).toBe(200);
    expect(inserts[1]![0]).toBe("err_tool");
    expect(inserts[1]![3]).toBe(500);
  });

  it("re-throws after logging when the handler throws", async () => {
    const inserts: unknown[][] = [];
    const poolFn = makePool(async (_sql, params) => {
      inserts.push(params as unknown[]);
      return { rows: [] };
    });
    const boomHandler = vi.fn().mockRejectedValue(new Error("kaboom"));

    await expect(
      withCallLog("boom_tool", boomHandler, poolFn)({}, {}),
    ).rejects.toThrow("kaboom");

    await new Promise((r) => setTimeout(r, 10));

    expect(inserts.length).toBe(1);
    expect(inserts[0]![0]).toBe("boom_tool");
    expect(inserts[0]![3]).toBe(500);
  });
});
