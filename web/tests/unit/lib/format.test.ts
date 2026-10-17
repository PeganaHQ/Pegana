import { describe, it, expect } from "vitest";
import {
  discountToBps,
  formatBps,
  formatUsd,
  formatUsdValue,
  formatMarketCapUsd,
  formatSupplyCompact,
  parseMarketCapUsd,
  parseCirculatingSupply,
  reconcileBps,
  cleanSeries,
  cleanBpsSeries,
  isPlausibleDiscount,
  pegJitter,
  jitterLabel,
  dispersionBps,
} from "@/lib/api/format";

describe("format helpers", () => {
  it("converts decimal discount to bps", () => {
    expect(discountToBps("0.0024")).toBe(24);
    expect(discountToBps("-0.0024")).toBe(-24);
    expect(discountToBps(null)).toBeNull();
  });

  it("formats bps with proper sign", () => {
    expect(formatBps(24)).toBe("+24 bps");
    expect(formatBps(-24)).toBe("−24 bps");
    expect(formatBps(0)).toBe("0 bps");
  });

  it("formats USD with adaptive decimals", () => {
    expect(formatUsd("1.000123", 4)).toBe("$1.0001");
    expect(formatUsd("0.999876", 4)).toBe("$0.9999");
    expect(formatUsd(null)).toBe("-");
  });

  // formatUsdValue: the *_usd API fields (market_usd / intrinsic_usd) are always
  // denominated in USD, regardless of an asset's peg_target. They must render
  // with a "$" and magnitude-adaptive precision — never with a "SOL"/"BRL" suffix
  // (the bug that made jitoSOL read "100.99 SOL" for a ~1.04-SOL, ~$101 asset).
  it("formats *_usd values as USD with magnitude-adaptive precision", () => {
    // ≥100 → 2 decimals (an LST priced in USD, e.g. jitoSOL market_usd)
    expect(formatUsdValue("100.991369666778368000")).toBe("$100.99");
    // <10 → keep 4 decimals so sub-dollar synths/stables don't collapse to "$0.05"
    expect(formatUsdValue("0.046541402366200000")).toBe("$0.0465");
    expect(formatUsdValue("0.999685870000000000")).toBe("$0.9997");
    // never emit a bare "$—"
    expect(formatUsdValue(null)).toBe("-");
    expect(formatUsdValue("not a number")).toBe("-");
  });
});

// market_cap / circulating_supply: nullable size/context fields (rust_decimal
// serialized as a JSON string, same shape as `discount`) — null until the
// backend ships the market-cap migration + indexer. Both formatters must
// degrade to "—" rather than a fabricated "$NaN".
describe("market cap + circulating supply — size/context, not peg-safety", () => {
  it("parses a market_cap string into a number, null on missing/garbage", () => {
    expect(parseMarketCapUsd("30000000000")).toBe(30_000_000_000);
    expect(parseMarketCapUsd(null)).toBeNull();
    expect(parseMarketCapUsd(undefined)).toBeNull();
    expect(parseMarketCapUsd("not a number")).toBeNull();
  });

  it("formats market cap at compact USD magnitude, '-' when null", () => {
    expect(formatMarketCapUsd(30_000_000_000)).toBe("$30.00B");
    expect(formatMarketCapUsd(430_000_000)).toBe("$430.00M");
    expect(formatMarketCapUsd(null)).toBe("-");
  });

  it("parses circulating_supply the same way as market_cap", () => {
    expect(parseCirculatingSupply("417320000")).toBe(417_320_000);
    expect(parseCirculatingSupply(null)).toBeNull();
    expect(parseCirculatingSupply("garbage")).toBeNull();
  });

  it("formats circulating supply as a compact token count with no currency prefix", () => {
    expect(formatSupplyCompact(417_320_000)).toBe("417.32M");
    expect(formatSupplyCompact(8_600)).toBe("8.6K");
    expect(formatSupplyCompact(null)).toBe("-");
  });
});

describe("reconcileBps — anomaly-resistant spread", () => {
  it("returns declared bps when sane and matches raw prices", () => {
    // intrinsic 1.0, market 0.998 → declared spread +20 bps (matches)
    const r = reconcileBps({
      discount: "0.002",
      intrinsic_usd: "1.000000",
      market_usd: "0.998000",
    });
    expect(r.bps).toBe(20);
    expect(r.suspect).toBe(false);
  });

  it("flags suspect and uses computed when declared diverges by >200 bps", () => {
    // raw prices say -65 bps (market 0.65% above intrinsic), declared says -1070 bps
    // — classic EWMA recovering from a corrupted upstream sample
    const r = reconcileBps({
      discount: "-0.107",
      intrinsic_usd: "0.061838",
      market_usd: "0.062234",
    });
    expect(r.declared_bps).toBe(-1070);
    expect(r.computed_bps).toBe(-64);
    expect(r.bps).toBe(-64);
    expect(r.suspect).toBe(true);
  });

  it("does NOT flag suspect on normal EWMA lag during a real move", () => {
    // Real depeg starting: declared (smoothed) lags raw by ~100 bps. This
    // should still display the declared value with no recovery banner.
    const r = reconcileBps({
      discount: "0.0100",
      intrinsic_usd: "1.000000",
      market_usd: "0.998000", // computed = +20 bps; declared = +100 bps; drift = 80
    });
    expect(r.declared_bps).toBe(100);
    expect(r.computed_bps).toBe(20);
    expect(r.suspect).toBe(false);
    expect(r.bps).toBe(100); // declared still trusted (drift < 200)
  });

  it("flags suspect when computed itself is physically impossible", () => {
    // Garbage intrinsic (oracle glitch produced near-zero NAV). We can't
    // trust either path, but declared looks sane → keep declared, no banner.
    const r = reconcileBps({
      discount: "0.002",
      intrinsic_usd: "0.0000001", // computed will be huge
      market_usd: "0.10",
    });
    expect(r.bps).toBe(20);
    expect(r.suspect).toBe(false);
  });

  it("treats |discount| > 1.0 as physically impossible", () => {
    const r = reconcileBps({
      discount: "-1160.47",
      intrinsic_usd: "0.062",
      market_usd: "0.0622",
    });
    expect(r.suspect).toBe(true);
    expect(r.bps).toBe(r.computed_bps); // fall back to the raw recomputation
  });

  it("handles missing raw prices by trusting the declared value", () => {
    const r = reconcileBps({
      discount: "0.0024",
      intrinsic_usd: null,
      market_usd: null,
    });
    expect(r.bps).toBe(24);
    expect(r.suspect).toBe(false);
  });

  it("nulls out everything when discount is impossible AND no raw prices", () => {
    const r = reconcileBps({
      discount: "-1160.47",
      intrinsic_usd: null,
      market_usd: null,
    });
    expect(r.bps).toBeNull();
    expect(r.suspect).toBe(true);
  });

  it("survives garbage strings without throwing", () => {
    const r = reconcileBps({
      discount: "not a number",
      intrinsic_usd: "also bad",
      market_usd: "",
    });
    expect(r.bps).toBeNull();
    expect(r.suspect).toBe(false);
  });
});

describe("cleanSeries — outlier-resistant samples", () => {
  it("keeps plausible discount values (|d| ≤ 1.0)", () => {
    expect(cleanSeries([0.0001, -0.002, 0.999, -1.0])).toEqual([
      0.0001, -0.002, 0.999, -1.0,
    ]);
  });

  it("drops physically-impossible values", () => {
    expect(cleanSeries([0.0001, -91.44, 0.001, -1160])).toEqual([
      0.0001, 0.001,
    ]);
  });

  it("drops NaN and Infinity", () => {
    expect(cleanSeries([0.001, NaN, Infinity, -Infinity, 0.002])).toEqual([
      0.001, 0.002,
    ]);
  });

  it("handles empty / null / undefined", () => {
    expect(cleanSeries([])).toEqual([]);
    expect(cleanSeries(null)).toEqual([]);
    expect(cleanSeries(undefined)).toEqual([]);
  });
});

describe("cleanBpsSeries — same filter in bps units", () => {
  it("filters to |bps| ≤ 10000 by default", () => {
    expect(cleanBpsSeries([20, -50, 9000, -10001, 12000])).toEqual([
      20, -50, 9000,
    ]);
  });
});

// pegJitter: a peg-stability / dispersion signal computed from the inline
// `series_24h` (fractional discounts). Two assets can show the SAME instantaneous
// spread yet behave totally differently — a steady −0.30% vs a whipsawing ±0.30%.
// Population standard deviation of the series, expressed in bps (×10000), turns
// Pegana from a lagging state-reporter into a leading indicator. Outliers are
// dropped first (reuse cleanSeries) so one bad print doesn't dominate.
describe("pegJitter — dispersion of the 24h spread series (bps)", () => {
  it("is 0 for a perfectly flat series", () => {
    expect(pegJitter([-0.003, -0.003, -0.003])).toBe(0);
  });

  it("returns the population standard deviation in bps", () => {
    // bps: [-48, -50, -46, -48] → mean -48 → sd = sqrt((0+4+4+0)/4) = sqrt(2)
    expect(pegJitter([-0.0048, -0.005, -0.0046, -0.0048])).toBeCloseTo(
      1.414,
      2,
    );
  });

  it("drops physically-impossible samples before measuring", () => {
    // the 5.0 (|d|>1.0) is upstream garbage — must not inflate the dispersion
    expect(pegJitter([-0.0048, -0.005, 5.0, -0.0046, -0.0048])).toBeCloseTo(
      1.414,
      2,
    );
  });

  it("needs at least 2 samples to measure dispersion", () => {
    expect(pegJitter([-0.003])).toBeNull();
    expect(pegJitter([])).toBeNull();
    expect(pegJitter(null)).toBeNull();
    expect(pegJitter(undefined)).toBeNull();
  });

  it("captures a whipsaw the instantaneous spread hides", () => {
    const steady = pegJitter([-0.003, -0.003, -0.003, -0.003]);
    const choppy = pegJitter([-0.003, 0.003, -0.003, 0.003]);
    expect(steady).toBe(0);
    expect(choppy).toBeGreaterThan(20); // ±30 bps swing → sd 30 bps
  });
});

describe("dispersionBps — parse backend jitter_bps_24h / worst_abs_24h to bps", () => {
  it("converts a signed-fraction Decimal string to bps (×10000)", () => {
    expect(dispersionBps("0.0123")).toBeCloseTo(123, 6);
    expect(dispersionBps("0.005")).toBeCloseTo(50, 6);
  });
  it("treats a flat/zero range as 0, not null", () => {
    expect(dispersionBps("0")).toBe(0);
  });
  it("returns null when absent (falls back to the series range / '—')", () => {
    expect(dispersionBps(null)).toBeNull();
    expect(dispersionBps(undefined)).toBeNull();
  });
  it("rejects NaN and out-of-band values (never a fake number)", () => {
    expect(dispersionBps("not-a-number")).toBeNull();
    expect(dispersionBps("-0.01")).toBeNull(); // dispersion is non-negative
    expect(dispersionBps("2.5")).toBeNull(); // range > 2×MAX_PLAUSIBLE (20000 bps)
  });
});

describe("jitterLabel — coarse stability bucket", () => {
  it("buckets bps dispersion into steady / choppy / volatile", () => {
    expect(jitterLabel(2)).toBe("steady");
    expect(jitterLabel(10)).toBe("choppy");
    expect(jitterLabel(25)).toBe("volatile");
  });
  it("reports unknown when dispersion is unmeasurable", () => {
    expect(jitterLabel(null)).toBe("unknown");
  });
});

describe("isPlausibleDiscount", () => {
  it("accepts realistic values", () => {
    expect(isPlausibleDiscount("0.002")).toBe(true);
    expect(isPlausibleDiscount(-0.5)).toBe(true);
    expect(isPlausibleDiscount(1.0)).toBe(true);
  });
  it("rejects out-of-range / NaN / null", () => {
    expect(isPlausibleDiscount("-91.44")).toBe(false);
    expect(isPlausibleDiscount(NaN)).toBe(false);
    expect(isPlausibleDiscount(null)).toBe(false);
    expect(isPlausibleDiscount(undefined)).toBe(false);
  });
});
