import { describe, it, expect } from "vitest";
import { bandSpecs } from "@/components/organisms/asset-chart-bands";

// The shaded-band geometry mirrors thresholdLineSpecs/addThresholdLines exactly
// (asset-chart.tsx). The chart plots the HOLDER-signed spread (premium +,
// discount −), so direction-sensitive classes (LST/stable_yield/synth_lev,
// ADR-0021) only trip on the −discount side → ONLY negative bands are emitted
// for them; symmetric classes get the mirrored positive side too. Getting this
// sign wrong is the A10-class failure (shading the benign premium side) — hence
// these tests (2026-07-23 QA sign flip).

const T = { driftBps: 55, depegBps: 140, criticalBps: 300 };

describe("bandSpecs — direction-sensitive (premium is benign)", () => {
  const specs = bandSpecs({ ...T, directionSensitive: true });

  it("emits exactly the three −discount-side bands, none on the premium side", () => {
    expect(specs).toHaveLength(3);
    expect(specs.every((b) => b.priceHigh <= 0)).toBe(true);
  });

  it("bands sit at −drift->−depeg, −depeg->−critical, −critical->edge", () => {
    expect(specs[0]).toMatchObject({ priceLow: -140, priceHigh: -55 });
    expect(specs[1]).toMatchObject({ priceLow: -300, priceHigh: -140 });
    expect(specs[2]).toMatchObject({ priceLow: -Infinity, priceHigh: -300 });
  });
});

describe("bandSpecs — symmetric (depeg can travel either way)", () => {
  const specs = bandSpecs({ ...T, directionSensitive: false });

  it("mirrors every positive band onto the negative side (6 total)", () => {
    expect(specs).toHaveLength(6);
    expect(
      specs.filter((b) => b.priceHigh <= 0 || b.priceLow < 0),
    ).toHaveLength(3);
  });

  it("the negative critical band is the exact reflection of the positive one", () => {
    // positive critical: {300, Infinity} -> negative: {-Infinity, -300}
    const neg = specs.find(
      (b) => b.priceLow === -Infinity && b.priceHigh === -300,
    );
    expect(neg).toBeDefined();
    // and the mirrored amber: {55,140} -> {-140,-55}
    expect(specs.some((b) => b.priceLow === -140 && b.priceHigh === -55)).toBe(
      true,
    );
  });
});

describe("bandSpecs — edge cases", () => {
  it("without criticalBps, the depeg band runs to the edge (2 −side bands)", () => {
    const specs = bandSpecs({
      driftBps: 55,
      depegBps: 140,
      directionSensitive: true,
    });
    expect(specs).toHaveLength(2);
    expect(specs[1]).toMatchObject({ priceLow: -Infinity, priceHigh: -140 });
  });

  it("collapses the amber band when depeg is not wider than drift", () => {
    const specs = bandSpecs({
      driftBps: 140,
      depegBps: 140,
      criticalBps: 300,
      directionSensitive: true,
    });
    // no drift->depeg band (depeg not > drift); still has depeg->critical + critical->edge
    expect(specs.some((b) => b.priceLow === 55)).toBe(false);
    expect(specs).toHaveLength(2);
  });
});
