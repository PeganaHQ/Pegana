import { describe, it, expect } from "vitest";
import { legsAvailable, impliedGapBps } from "@/lib/asset/legs";

describe("legsAvailable — Legs view is only honest for USD-peg assets", () => {
  it("is true only when the peg target is USD", () => {
    expect(legsAvailable("USD")).toBe(true);
  });

  it("is false for SOL-peg LSTs — both USD legs carry the SOL/USD tick and swing with SOL while the real SOL-space peg is fine", () => {
    expect(legsAvailable("SOL")).toBe(false);
  });

  it("is false for EUR-peg (EURC) — USD legs carry the EUR/USD tick, the identical trap as LSTs", () => {
    expect(legsAvailable("EUR")).toBe(false);
  });

  it("is false for BRL-peg", () => {
    expect(legsAvailable("BRL")).toBe(false);
  });

  it("fails safe for missing / unknown peg targets", () => {
    expect(legsAvailable(undefined)).toBe(false);
    expect(legsAvailable(null)).toBe(false);
    expect(legsAvailable("")).toBe(false);
    expect(legsAvailable("usd")).toBe(false); // exact, case-sensitive against the enum
  });
});

describe("impliedGapBps — the discount signal recovered from the two legs", () => {
  // Matches the engine sign convention discount = (intrinsic − market)/intrinsic:
  // a market BELOW NAV is a positive (discount) bps; ABOVE NAV is negative (premium).
  it("is a positive discount when market is below intrinsic", () => {
    expect(impliedGapBps(0.9996, 1.0)).toBe(4); // 0.04% below NAV
  });

  it("is a negative premium when market is above intrinsic", () => {
    expect(impliedGapBps(1.002, 1.0)).toBe(-20);
  });

  it("is relative, not absolute — a yield-bearing NAV > $1 (sHYUSD) still reads correctly", () => {
    // market 1.00 vs intrinsic 1.05 → 1 − 1/1.05 = 0.047619 → 476 bps discount
    expect(impliedGapBps(1.0, 1.05)).toBe(476);
  });

  it("returns null when intrinsic is non-positive or either input is not finite", () => {
    expect(impliedGapBps(1.0, 0)).toBeNull();
    expect(impliedGapBps(1.0, -1)).toBeNull();
    expect(impliedGapBps(Number.NaN, 1.0)).toBeNull();
    expect(impliedGapBps(1.0, Number.NaN)).toBeNull();
  });
});
