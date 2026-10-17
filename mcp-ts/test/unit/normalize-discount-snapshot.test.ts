import { describe, it, expect } from "vitest";
import { normalizeDiscountSnapshot } from "@/shared/types";

// Regression for B-008/B-009: engine publishes `updated_at: ISO`, but the
// tool schemas (get_assets, get_asset_state) require `ts: number` in unix
// seconds. Before the fix, the cache stored snapshots without `ts`, every
// call returned MCP -32602 Output validation error. Lock the contract here.

describe("normalizeDiscountSnapshot", () => {
  it("derives ts (unix seconds) from updated_at (ISO)", () => {
    const wire = {
      asset: "jitoSOL",
      state: "PEGGED" as const,
      discount: "-0.00198",
      intrinsic_usd: "104.87",
      market_usd: "105.25",
      updated_at: "2026-05-29T19:38:00.000Z",
      // ts intentionally absent — engine doesn't send it
    } as unknown as Parameters<typeof normalizeDiscountSnapshot>[0];
    const out = normalizeDiscountSnapshot(wire);
    expect(typeof out.ts).toBe("number");
    // 2026-05-29T19:38:00Z = unix sec 1780083480
    expect(out.ts).toBe(1780083480);
  });

  it("normalizes BLACKSWAN → BLACK_SWAN", () => {
    const wire = {
      asset: "x",
      state: "BLACKSWAN" as unknown as "BLACK_SWAN",
      discount: "0",
      intrinsic_usd: "1",
      market_usd: "1",
      ts: 0,
    };
    const out = normalizeDiscountSnapshot(wire);
    expect(out.state).toBe("BLACK_SWAN");
  });

  it("preserves existing ts when wire payload already includes it", () => {
    const wire = {
      asset: "x",
      state: "PEGGED" as const,
      discount: "0",
      intrinsic_usd: "1",
      market_usd: "1",
      ts: 1234567890,
    };
    const out = normalizeDiscountSnapshot(wire);
    expect(out.ts).toBe(1234567890);
  });

  it("falls back to now() when updated_at is malformed", () => {
    const beforeSec = Math.floor(Date.now() / 1000);
    const wire = {
      asset: "x",
      state: "PEGGED" as const,
      discount: "0",
      intrinsic_usd: "1",
      market_usd: "1",
      updated_at: "not-an-iso-string",
    } as unknown as Parameters<typeof normalizeDiscountSnapshot>[0];
    const out = normalizeDiscountSnapshot(wire);
    expect(out.ts).toBeGreaterThanOrEqual(beforeSec);
    expect(out.ts).toBeLessThanOrEqual(beforeSec + 2);
  });
});
