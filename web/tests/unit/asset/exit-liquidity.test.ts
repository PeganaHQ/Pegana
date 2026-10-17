import { describe, it, expect } from "vitest";
import {
  fmtUsd,
  fmtSize,
  impactColor,
  safeExitSize,
  IMPACT_THRESHOLD_PCT,
  type ExitQuoteRow,
} from "@/lib/asset/exit-liquidity";

describe("fmtSize", () => {
  it("covers the $1k → $1M desktop ladder", () => {
    expect(fmtSize(1_000)).toBe("$1k");
    expect(fmtSize(10_000)).toBe("$10k");
    expect(fmtSize(50_000)).toBe("$50k");
    expect(fmtSize(250_000)).toBe("$250k");
    expect(fmtSize(500_000)).toBe("$500k");
    expect(fmtSize(1_000_000)).toBe("$1M");
    expect(fmtSize(1_500_000)).toBe("$1.5M");
  });
});

describe("fmtUsd", () => {
  it("formats M / k / cents", () => {
    expect(fmtUsd(1_000_000)).toBe("$1.00M");
    expect(fmtUsd(10_000)).toBe("$10k");
    expect(fmtUsd(5_000)).toBe("$5.0k");
    expect(fmtUsd(999.99)).toBe("$999.99");
  });
});

describe("impactColor", () => {
  it("green <0.05, amber <0.3, red ≥0.3", () => {
    expect(impactColor(0.04)).toBe("text-st-pegged");
    expect(impactColor(0.05)).toBe("text-st-drift");
    expect(impactColor(0.29)).toBe("text-st-drift");
    expect(impactColor(0.3)).toBe("text-st-depeg-text");
    expect(impactColor(1.2)).toBe("text-st-depeg-text");
  });
});

describe("safeExitSize", () => {
  const THRESH = IMPACT_THRESHOLD_PCT;
  it("exposes the 0.3% threshold constant", () => {
    expect(THRESH).toBe(0.3);
  });

  it("returns the largest size strictly under the threshold", () => {
    const rows: ExitQuoteRow[] = [
      { sizeUsd: 1_000, impactPct: 0.01 },
      { sizeUsd: 10_000, impactPct: 0.12 },
      { sizeUsd: 50_000, impactPct: 0.28 },
      { sizeUsd: 250_000, impactPct: 0.45 },
      { sizeUsd: 1_000_000, impactPct: 1.2 },
    ];
    expect(safeExitSize(rows)).toBe(50_000);
  });

  it("excludes a size whose impact is exactly the threshold (strict <)", () => {
    const rows: ExitQuoteRow[] = [
      { sizeUsd: 50_000, impactPct: 0.29 },
      { sizeUsd: 100_000, impactPct: 0.3 },
      { sizeUsd: 250_000, impactPct: 0.31 },
    ];
    expect(safeExitSize(rows)).toBe(50_000);
  });

  it("ignores null-impact (loading/failed) rows", () => {
    const rows: ExitQuoteRow[] = [
      { sizeUsd: 1_000, impactPct: null },
      { sizeUsd: 10_000, impactPct: 0.12 },
      { sizeUsd: 100_000, impactPct: null },
      { sizeUsd: 250_000, impactPct: 0.35 },
    ];
    expect(safeExitSize(rows)).toBe(10_000);
  });

  it("does NOT null-out a non-monotonic curve — takes the largest clearing size", () => {
    // Jupiter route-splitting can dip impact at a larger size; that is valid.
    const rows: ExitQuoteRow[] = [
      { sizeUsd: 1_000, impactPct: 0.1 },
      { sizeUsd: 10_000, impactPct: 0.05 }, // dip — still valid
      { sizeUsd: 100_000, impactPct: 0.5 },
    ];
    expect(safeExitSize(rows)).toBe(10_000);
  });

  it("returns null when no sampled size clears the threshold", () => {
    const rows: ExitQuoteRow[] = [
      { sizeUsd: 1_000, impactPct: 0.5 },
      { sizeUsd: 10_000, impactPct: 0.9 },
    ];
    expect(safeExitSize(rows)).toBeNull();
  });

  it("returns null for empty or all-null input", () => {
    expect(safeExitSize([])).toBeNull();
    expect(safeExitSize([{ sizeUsd: 1_000, impactPct: null }])).toBeNull();
  });

  it("respects a custom threshold", () => {
    const rows: ExitQuoteRow[] = [
      { sizeUsd: 1_000, impactPct: 0.02 },
      { sizeUsd: 10_000, impactPct: 0.1 },
    ];
    expect(safeExitSize(rows, 0.05)).toBe(1_000);
  });
});
