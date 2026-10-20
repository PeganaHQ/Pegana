import { describe, expect, it } from "vitest";
import {
  fractionToBps,
  markerPercent,
  requestLine,
  scaleBands,
  scaleMaxBps,
} from "@/lib/landing/verdict-scale";

const T = { drift_bps: 45, depeg_bps: 110, critical_bps: 250 };

describe("threshold scale math", () => {
  it("runs the scale to 1.25x critical", () => {
    expect(scaleMaxBps(T)).toBe(312.5);
  });

  it("places band edges at the real thresholds", () => {
    const [pegged, drift, depeg, critical] = scaleBands(T);
    expect(pegged.from).toBe(0);
    expect(drift.from).toBeCloseTo((45 / 312.5) * 100, 6);
    expect(depeg.from).toBeCloseTo((110 / 312.5) * 100, 6);
    expect(critical.from).toBeCloseTo(80, 6);
    expect(critical.to).toBe(100);
    expect(pegged.to).toBe(drift.from);
  });

  it("positions the marker by absolute discount and clamps", () => {
    expect(markerPercent(0, T)).toBe(0);
    expect(markerPercent(110, T)).toBeCloseTo(35.2, 6);
    expect(markerPercent(-110, T)).toBeCloseTo(35.2, 6);
    expect(markerPercent(9999, T)).toBe(100);
  });

  it("converts a discount fraction to bps without inventing values", () => {
    expect(fractionToBps("0.000951")).toBeCloseTo(9.51, 6);
    expect(fractionToBps(null)).toBeNull();
    expect(fractionToBps("nope")).toBeNull();
  });

  it("builds real request lines only", () => {
    expect(requestLine("rest", "jitoSOL")).toBe(
      "GET https://api.pegana.xyz/v1/assets/jitoSOL",
    );
    expect(requestLine("ws", "jitoSOL")).toContain("wss://api.pegana.xyz/v1/ws");
    expect(requestLine("mcp", "mSOL")).toContain("get_asset_state");
    expect(requestLine("mcp", "mSOL")).toContain("mSOL");
    expect(requestLine("cli", "mSOL")).toBe("pegana-replay --alert-id <id>");
  });
});
