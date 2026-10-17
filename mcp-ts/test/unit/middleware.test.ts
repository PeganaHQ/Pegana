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
import {
  address,
  getCompiledTransactionMessageEncoder,
  getTransactionEncoder,
  getBase64Decoder,
} from "@solana/kit";

import { withCallLog } from "@/middleware/call-log";
import { withRateLimit } from "@/middleware";
import {
  RATE_LIMIT_PER_MIN,
  _resetForTests,
} from "@/middleware/rate-limit";
import {
  extractFingerprint,
  fingerprintFromMeta,
} from "@/middleware/fingerprint";

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

// ── Fingerprint paid-path tests ────────────────────────────────────
//
// Audit B P1 (#1): hashing the raw X-PAYMENT envelope was broken because
// every signed payment carries a fresh recent-blockhash, so the rate
// limit never engaged for paid tools. The fix decodes the SVM wire
// transaction and hashes its `staticAccounts` (payer wallet, payer
// token account, receiver token account, token program, fee payer, …),
// which IS stable across payments from the same payer to the same
// receiver. These tests pin that contract: same payer = same
// fingerprint; different payer = different fingerprint.
//
// We build minimal but valid x402 SVM envelopes via @solana/kit's own
// codecs so the test verifies the actual decode path the production
// middleware takes, not a parallel mock.

function buildSvmEnvelope(opts: {
  payer: string;
  payerTokenAccount: string;
  // Recent blockhash. Vary between payments from the same payer to prove
  // the envelope bytes change while the fingerprint does NOT.
  recentBlockhash: string;
}): string {
  // Static accounts: index 0 must be the fee-payer / signer; we put the
  // user wallet there for simplicity. Index 1 onward = readonly non-
  // signers (their token account, etc).
  const staticAccounts = [
    address(opts.payer),
    address(opts.payerTokenAccount),
    // Receiver / facilitator token account — kept constant across all
    // payments in these tests so the only varying static-account is the
    // payer wallet between distinct payers.
    address("So11111111111111111111111111111111111111112"),
  ];
  const compiled = {
    version: 0 as const,
    header: {
      numSignerAccounts: 1,
      numReadonlySignerAccounts: 0,
      numReadonlyNonSignerAccounts: 2,
    },
    staticAccounts,
    instructions: [],
    lifetimeToken: opts.recentBlockhash,
  };
  const messageBytes = getCompiledTransactionMessageEncoder().encode(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compiled as any,
  ) as Uint8Array;
  // Wire-encode with one all-zero signature for the single signer.
  const transactionBytes = getTransactionEncoder().encode({
    signatures: [new Uint8Array(64)],
    messageBytes,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any) as Uint8Array;
  const transactionB64 = getBase64Decoder().decode(transactionBytes);
  const envelope = {
    x402Version: 1,
    scheme: "exact",
    network: "solana",
    payload: { transaction: transactionB64 },
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}

describe("extractFingerprint paid path (audit B P1 #1)", () => {
  // A pair of well-formed base58 Solana addresses. These are NOT real
  // mainnet wallets — they're just two distinct valid pubkeys.
  const PAYER_A = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const PAYER_B = "11111111111111111111111111111112";
  const PAYER_A_TOKEN = "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy";
  const PAYER_B_TOKEN = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

  it("two payments from the same payer produce the SAME fingerprint", () => {
    const env1 = buildSvmEnvelope({
      payer: PAYER_A,
      payerTokenAccount: PAYER_A_TOKEN,
      recentBlockhash: "11111111111111111111111111111111",
    });
    const env2 = buildSvmEnvelope({
      payer: PAYER_A,
      payerTokenAccount: PAYER_A_TOKEN,
      // Different recent blockhash → different envelope bytes, but same payer.
      recentBlockhash: "11111111111111111111111111111112",
    });
    expect(env1).not.toBe(env2); // sanity: envelopes themselves differ
    const fp1 = extractFingerprint({ "x-payment": env1 });
    const fp2 = extractFingerprint({ "x-payment": env2 });
    expect(fp1).toBeDefined();
    expect(fp1).toBe(fp2);
  });

  it("payments from different payers produce DIFFERENT fingerprints", () => {
    const envA = buildSvmEnvelope({
      payer: PAYER_A,
      payerTokenAccount: PAYER_A_TOKEN,
      recentBlockhash: "11111111111111111111111111111111",
    });
    const envB = buildSvmEnvelope({
      payer: PAYER_B,
      payerTokenAccount: PAYER_B_TOKEN,
      recentBlockhash: "11111111111111111111111111111111",
    });
    const fpA = extractFingerprint({ "x-payment": envA });
    const fpB = extractFingerprint({ "x-payment": envB });
    expect(fpA).toBeDefined();
    expect(fpB).toBeDefined();
    expect(fpA).not.toBe(fpB);
  });

  it("fingerprintFromMeta agrees with extractFingerprint on the same payer", () => {
    const env = buildSvmEnvelope({
      payer: PAYER_A,
      payerTokenAccount: PAYER_A_TOKEN,
      recentBlockhash: "11111111111111111111111111111111",
    });
    const fromHeader = extractFingerprint({ "x-payment": env });
    const fromMeta = fingerprintFromMeta({ "x402/payment": env });
    expect(fromHeader).toBe(fromMeta);
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
