import { describe, it, expect } from "vitest";
import {
  fmtUsd,
  fmtSize,
  impactColor,
  safeExitSize,
  noMeasurableImpactUpTo,
  nextQuotePrice,
  quoteAmountBaseUnits,
  scaleOutToRequestedSize,
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

describe("nextQuotePrice (re-quote only on a real move)", () => {
  it("adopts the first valid price", () => {
    expect(nextQuotePrice(null, 1.23)).toBe(1.23);
  });
  it("keeps the current price for a sub-1% move", () => {
    expect(nextQuotePrice(100, 100.5)).toBe(100);
    expect(nextQuotePrice(100, 99.2)).toBe(100);
  });
  it("advances on a move of 1% or more", () => {
    expect(nextQuotePrice(100, 101)).toBe(101);
    expect(nextQuotePrice(100, 98)).toBe(98);
  });
  it("ignores missing or invalid prices", () => {
    expect(nextQuotePrice(100, null)).toBe(100);
    expect(nextQuotePrice(100, 0)).toBe(100);
    expect(nextQuotePrice(null, Number.NaN)).toBeNull();
  });
});

describe("quoteAmountBaseUnits (cache-friendly amounts)", () => {
  it("rounds to three significant figures in base units", () => {
    // $10k of a $178.37 token with 9 decimals = 56.06...e9 base units.
    expect(quoteAmountBaseUnits(10_000, 178.37, 9)).toBe(56_100_000_000);
  });
  it("gives every caller the same amount for nearby prices", () => {
    expect(quoteAmountBaseUnits(1_000, 1.0001, 6)).toBe(
      quoteAmountBaseUnits(1_000, 1.0004, 6),
    );
  });
  it("stays within 0.5% of the exact amount", () => {
    for (const [size, px, dec] of [
      [1_000, 0.9998, 6],
      [250_000, 212.4, 9],
      [1_000_000, 0.0507, 6],
    ] as const) {
      const exact = (size / px) * 10 ** dec;
      const got = quoteAmountBaseUnits(size, px, dec);
      expect(Math.abs(got - exact) / exact).toBeLessThanOrEqual(0.005);
    }
  });
  it("never returns a non-positive amount for a valid input", () => {
    expect(quoteAmountBaseUnits(1, 1e9, 0)).toBe(1);
  });
});

describe("scaleOutToRequestedSize", () => {
  it("rescales the receive amount from the rounded quote to the labelled size", () => {
    // USDT at 0.9988, $10k: 10012 tokens rounded to 10000 (6 decimals).
    const input = quoteAmountBaseUnits(10_000, 0.9988, 6);
    expect(input).toBe(10_000_000_000);
    // Jupiter returns ~9988 USDC for 10000 USDT at no slippage.
    const out = scaleOutToRequestedSize(9_988, input, 10_000, 0.9988, 6);
    expect(out).not.toBeNull();
    expect(out!).toBeCloseTo(10_000, 6);
  });

  it("keeps real slippage visible", () => {
    const input = quoteAmountBaseUnits(10_000, 0.9988, 6);
    // 1% below fair value on the quoted amount stays 1% below on the size.
    const out = scaleOutToRequestedSize(9_988 * 0.99, input, 10_000, 0.9988, 6);
    expect(out!).toBeCloseTo(9_900, 6);
  });

  it("returns null when the quoted size is unusable", () => {
    expect(scaleOutToRequestedSize(100, 0, 1_000, 1, 6)).toBeNull();
    expect(scaleOutToRequestedSize(Number.NaN, 1_000_000, 1, 1, 6)).toBeNull();
  });
});

describe("noMeasurableImpactUpTo", () => {
  const r = (sizeUsd: number, impactPct: number | null): ExitQuoteRow => ({
    sizeUsd,
    impactPct,
  });

  it("returns the largest size when every impact is below the display floor", () => {
    expect(
      noMeasurableImpactUpTo([r(1_000, 0), r(10_000, 0.0004), r(1_000_000, 0.0009)]),
    ).toBe(1_000_000);
  });

  it("is null as soon as one size shows a visible impact", () => {
    expect(noMeasurableImpactUpTo([r(1_000, 0), r(1_000_000, 0.001)])).toBeNull();
    expect(noMeasurableImpactUpTo([r(1_000, 0), r(1_000_000, 0.4)])).toBeNull();
  });

  it("is null when an impact is NaN or infinite", () => {
    expect(noMeasurableImpactUpTo([r(1_000, 0), r(10_000, Number.NaN)])).toBeNull();
    expect(noMeasurableImpactUpTo([r(1_000, Infinity)])).toBeNull();
  });

  it("is null while any row is loading or failed, and for no rows", () => {
    expect(noMeasurableImpactUpTo([r(1_000, 0), r(10_000, null)])).toBeNull();
    expect(noMeasurableImpactUpTo([])).toBeNull();
  });
});
