import { describe, it, expect } from "vitest";
import { normalizeDiscountSnapshot, type DiscountWire } from "@/shared/types";
import { normalizeDecimal, roundDecimal } from "@/shared/decimal";

// Regression for B-008/B-009: engine publishes `updated_at: ISO`, but the
// tool schemas (get_assets, get_asset_state) require `ts: number` in unix
// seconds. R1 audit idx 1/80: the output must carry ONLY the declared keys
// (no engine `kind`) and use the REST formats (6 dp discount, no trailing
// zeros, ISO-ms updated_at).

const base: DiscountWire = {
  asset: "USDC",
  state: "PEGGED",
  discount: "0.0001606721854266045903365197",
  intrinsic_usd: "1",
  market_usd: "0.99982736",
};

describe("normalizeDiscountSnapshot", () => {
  it("derives ts (unix seconds) and ISO-ms updated_at from a nanosecond updated_at", () => {
    const out = normalizeDiscountSnapshot({
      ...base,
      kind: "update",
      updated_at: "2026-05-29T19:38:00.536101419Z",
    });
    expect(out).toEqual({
      asset: "USDC",
      state: "PEGGED",
      discount: "0.000161",
      intrinsic_usd: "1",
      market_usd: "0.99982736",
      ts: 1780083480,
      updated_at: "2026-05-29T19:38:00.536Z",
    });
  });

  it("normalizes BLACKSWAN → BLACK_SWAN", () => {
    const out = normalizeDiscountSnapshot({ ...base, state: "BLACKSWAN", ts: 0 });
    expect(out?.state).toBe("BLACK_SWAN");
  });

  it("preserves an existing numeric ts", () => {
    const out = normalizeDiscountSnapshot({ ...base, ts: 1234567890 });
    expect(out?.ts).toBe(1234567890);
    expect(out?.updated_at).toBe("2009-02-13T23:31:30.000Z");
  });

  it("drops the snapshot when the timestamp is unusable (never invents one)", () => {
    expect(
      normalizeDiscountSnapshot({ ...base, updated_at: "not-an-iso-string" }),
    ).toBeUndefined();
    expect(normalizeDiscountSnapshot({ ...base })).toBeUndefined();
  });
});

describe("decimal helpers", () => {
  it("normalizeDecimal strips trailing zeros like rust_decimal normalize()", () => {
    expect(normalizeDecimal("0.000161000000000000000000")).toBe("0.000161");
    expect(normalizeDecimal("1.00000000000000000000")).toBe("1");
    expect(normalizeDecimal("-0.000000")).toBe("0");
    expect(normalizeDecimal("100")).toBe("100");
    expect(normalizeDecimal("-0.0042")).toBe("-0.0042");
    expect(normalizeDecimal("abc")).toBe("abc");
  });

  it("roundDecimal rounds half away from zero (Postgres NUMERIC)", () => {
    expect(roundDecimal("0.0001605", 6)).toBe("0.000161");
    expect(roundDecimal("-0.0001605", 6)).toBe("-0.000161");
    expect(roundDecimal("0.0001604999", 6)).toBe("0.00016");
    expect(roundDecimal("0.9999995", 6)).toBe("1");
    expect(roundDecimal("-0.0000004", 6)).toBe("0");
    expect(roundDecimal("104.41324565679740588639516784", 18)).toBe(
      "104.413245656797405886",
    );
    expect(roundDecimal("12.5", 0)).toBe("13");
    expect(roundDecimal("0.5", 6)).toBe("0.5");
  });
});
