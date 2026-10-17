import { describe, it, expect } from "vitest";
import { bandProximity, bandZone } from "@/lib/asset/band";
import type { AlertThresholds } from "@/lib/alerts/policy";

const USDC: AlertThresholds = {
  drift_bps: 15,
  depeg_bps: 50,
  critical_bps: 200,
};
const INF: AlertThresholds = {
  drift_bps: 140,
  depeg_bps: 280,
  critical_bps: 560,
};

describe("bandProximity — how close |spread| is to the depeg line", () => {
  it("expresses |bps| as a fraction of the asset's OWN depeg threshold", () => {
    // The whole point: −40 bps is 80% of the way to depeg for USDC, but only
    // ~14% for INF — the same number, very different risk.
    expect(bandProximity(-40, USDC)).toBeCloseTo(0.8, 3);
    expect(bandProximity(-40, INF)).toBeCloseTo(0.142857, 3);
  });

  it("is 0 at a perfect peg and ≥1 at/over the depeg line", () => {
    expect(bandProximity(0, USDC)).toBe(0);
    expect(bandProximity(-50, USDC)).toBe(1);
    expect(bandProximity(-75, USDC)).toBe(1.5);
  });

  it("uses magnitude (sign-independent)", () => {
    expect(bandProximity(30, USDC)).toBe(bandProximity(-30, USDC));
  });

  it("returns null when unmeasurable", () => {
    expect(bandProximity(null, USDC)).toBeNull();
    expect(
      bandProximity(-40, { drift_bps: 0, depeg_bps: 0, critical_bps: 0 }),
    ).toBeNull();
  });
});

describe("bandProximity — direction-sensitive carve-out (ADR-0021)", () => {
  // reconcileBps convention: bps > 0 ⇒ discount (market BELOW intrinsic),
  // bps < 0 ⇒ premium (market ABOVE intrinsic).
  it("a premium (bps < 0) on a direction-sensitive asset is benign: ZERO proximity, never off-scale", () => {
    expect(bandProximity(-911, USDC, true)).toBe(0);
    expect(bandProximity(-40, USDC, true)).toBe(0);
  });

  it("the discount side (bps > 0) still counts fully for a direction-sensitive asset", () => {
    expect(bandProximity(40, USDC, true)).toBeCloseTo(0.8, 3);
    expect(bandProximity(911, USDC, true)).toBeGreaterThan(1); // still off-scale
  });

  it("defaults to symmetric (|bps|) when directionSensitive is omitted — no behavior change for existing callers", () => {
    expect(bandProximity(-40, USDC)).toBe(bandProximity(-40, USDC, false));
    expect(bandProximity(-40, USDC)).toBeCloseTo(0.8, 3);
  });
});

describe("bandZone — which band |spread| falls in", () => {
  it("buckets by the asset's own thresholds", () => {
    expect(bandZone(5, USDC)).toBe("pegged"); // < drift 15
    expect(bandZone(-30, USDC)).toBe("drift"); // 15..50
    expect(bandZone(-120, USDC)).toBe("depeg"); // 50..200
    expect(bandZone(-250, USDC)).toBe("critical"); // > 200
  });
  it("returns unknown when unmeasurable", () => {
    expect(bandZone(null, USDC)).toBe("unknown");
  });
});
