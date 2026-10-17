import { describe, it, expect } from "vitest";
import {
  thresholdLineSpecs,
  thresholdAreaSpecs,
  priceRangeForGuides,
} from "@/lib/asset/chart-thresholds";

const TH = { drift_bps: 15, depeg_bps: 50, critical_bps: 200 };

describe("priceRangeForGuides — keep guide lines from squashing the live line", () => {
  it("returns null for an empty series (LWC default applies)", () => {
    expect(priceRangeForGuides([], 50)).toBeNull();
  });

  it("frames a calm asset by the depeg band, not by ±critical", () => {
    // USDC near peg: round(max(maxAbs=5, depeg=50) × 1.15) = 57, symmetric.
    expect(priceRangeForGuides([2, -3, 5], 50)).toEqual({
      minValue: -57,
      maxValue: 57,
    });
  });

  it("expands to the data when the line moves beyond depeg (critical reveals as approached)", () => {
    expect(priceRangeForGuides([100, -4000, 300], 3000)).toEqual({
      minValue: -4600,
      maxValue: 4600,
    });
  });

  it("still frames a flat-at-peg series by the depeg band", () => {
    expect(priceRangeForGuides([0, 0], 50)).toEqual({
      minValue: -57,
      maxValue: 57,
    });
  });

  it("ignores non-finite samples", () => {
    expect(
      priceRangeForGuides([Number.NaN, 5, Number.POSITIVE_INFINITY], 50),
    ).toEqual({
      minValue: -57,
      maxValue: 57,
    });
  });
});

// The engine classifies on |discount| (band magnitude), and a depeg can be a
// discount (+bps, market below NAV — where stables break) OR a premium (−bps).
// The chart historically drew the guide lines ONLY on the negative side, so a
// stablecoin depegging downward (positive discount) moved AWAY from its own red
// guides. The fix: emit a guide on BOTH sides of zero for every band.
describe("thresholdLineSpecs — symmetric guide lines", () => {
  it("emits both a +price and a −price line for every band", () => {
    const prices = thresholdLineSpecs(TH)
      .map((s) => s.price)
      .sort((a, b) => a - b);
    expect(prices).toEqual([-200, -50, -15, 15, 50, 200]);
  });

  it("tags each side with the correct band role", () => {
    const byPrice = Object.fromEntries(
      thresholdLineSpecs(TH).map((s) => [s.price, s.role]),
    );
    expect(byPrice[15]).toBe("drift");
    expect(byPrice[-15]).toBe("drift");
    expect(byPrice[50]).toBe("depeg");
    expect(byPrice[-50]).toBe("depeg");
    expect(byPrice[200]).toBe("critical");
    expect(byPrice[-200]).toBe("critical");
  });

  it("labels the signed magnitude so the discount (positive) side is no longer unlabeled", () => {
    const specs = thresholdLineSpecs(TH);
    const pos = specs.find((s) => s.price === 15)!;
    const neg = specs.find((s) => s.price === -15)!;
    expect(pos.title).toMatch(/drift/);
    expect(pos.title).toContain("+0.15%");
    expect(neg.title).toContain("−0.15%");
  });
});

// The chart plots the HOLDER-signed spread (premium +, discount −), so the
// DISCOUNT/risk side that direction-sensitive classes (LST, stable_yield,
// synth_lev) trip on is the NEGATIVE side. Guides on the premium (+) side there
// are misleading, so they're suppressed (2026-07-23 QA sign flip).
describe("thresholdLineSpecs — direction-sensitive (premium side suppressed)", () => {
  it("emits ONLY the −discount-side guide for each band when directionSensitive", () => {
    const prices = thresholdLineSpecs(TH, true)
      .map((s) => s.price)
      .sort((a, b) => a - b);
    expect(prices).toEqual([-200, -50, -15]);
  });

  it("keeps the symmetric pair when not direction-sensitive (default unchanged)", () => {
    const prices = thresholdLineSpecs(TH, false)
      .map((s) => s.price)
      .sort((a, b) => a - b);
    expect(prices).toEqual([-200, -50, -15, 15, 50, 200]);
  });

  it("still tags the surviving −side guides with their band role", () => {
    const byPrice = Object.fromEntries(
      thresholdLineSpecs(TH, true).map((s) => [s.price, s.role]),
    );
    expect(byPrice[-15]).toBe("drift");
    expect(byPrice[-50]).toBe("depeg");
    expect(byPrice[-200]).toBe("critical");
  });
});

describe("thresholdAreaSpecs — direction-sensitive bands", () => {
  it("suppresses all premium-side areas for direction-sensitive classes", () => {
    expect(thresholdAreaSpecs(TH, 250, true)).toEqual([
      { y1: 15, y2: 50, role: "drift" },
      { y1: 50, y2: 200, role: "depeg" },
      { y1: 200, y2: 250, role: "critical" },
    ]);
  });

  it("keeps symmetric areas for other classes", () => {
    expect(thresholdAreaSpecs(TH, 250, false)).toHaveLength(6);
    expect(thresholdAreaSpecs(TH, 250, false)).toContainEqual({
      y1: -50,
      y2: -15,
      role: "drift",
    });
  });
});
