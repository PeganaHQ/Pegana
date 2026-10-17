import { describe, it, expect } from "vitest";
import {
  sourcesDisagree,
  SOURCES_DISAGREE_TOLERANCE_BPS,
} from "@/lib/asset/legs";

// The "sources disagree" signal underpins the 3-leg differentiator: the widest
// pairwise gap among the independent USD price sources (intrinsic NAV, DEX
// market, Pyth oracle), in bps of the reference, vs a tolerance. The
// market↔oracle pair is the load-bearing one (two independent feeds).

describe("sourcesDisagree", () => {
  it("all three within tolerance → agree", () => {
    const v = sourcesDisagree({ intrinsic: 1, market: 1.0005, oracle: 0.9995 });
    expect(v.disagree).toBe(false);
    expect(v.maxSpreadBps).toBe(10); // widest = market↔oracle = 0.001 → 10bps
    expect(v.worstPair).toBe("market-oracle");
  });

  it("market↔oracle gap beyond tolerance → disagree, correct pair + bps", () => {
    // intrinsic 1.000, market 0.998 (−20), oracle 1.006 (+60) → m↔o = 80bps
    const v = sourcesDisagree({ intrinsic: 1, market: 0.998, oracle: 1.006 });
    expect(v.disagree).toBe(true);
    expect(v.maxSpreadBps).toBe(80);
    expect(v.worstPair).toBe("market-oracle");
  });

  it("fewer than two legs present → cannot compare, fail safe", () => {
    expect(sourcesDisagree({ intrinsic: 1 })).toEqual({
      disagree: false,
      maxSpreadBps: null,
      worstPair: null,
    });
    expect(
      sourcesDisagree({ intrinsic: 1, market: null, oracle: undefined }),
    ).toEqual({ disagree: false, maxSpreadBps: null, worstPair: null });
  });

  it("intrinsic absent → reference falls back to the mean of present legs", () => {
    const v = sourcesDisagree({ market: 1, oracle: 1.005 });
    // ref = 1.0025; |1 − 1.005| / 1.0025 × 1e4 ≈ 50bps
    expect(v.maxSpreadBps).toBe(50);
    expect(v.worstPair).toBe("market-oracle");
    expect(v.disagree).toBe(false);
  });

  it("respects a custom tolerance", () => {
    const legs = { intrinsic: 1, market: 1, oracle: 0.99 }; // 100bps gap
    expect(sourcesDisagree(legs).disagree).toBe(true); // default 75
    expect(sourcesDisagree(legs, 150).disagree).toBe(false);
    expect(sourcesDisagree(legs, 150).maxSpreadBps).toBe(100);
  });

  it("is sign-agnostic (premium diverges same as discount)", () => {
    const disc = sourcesDisagree({ intrinsic: 1, market: 0.99, oracle: 1 });
    const prem = sourcesDisagree({ intrinsic: 1, market: 1.01, oracle: 1 });
    expect(disc.maxSpreadBps).toBe(prem.maxSpreadBps);
    expect(disc.disagree).toBe(prem.disagree);
  });

  it("drops a non-positive leg instead of fabricating a false spread", () => {
    // A zeroed/garbage oracle print must NOT read as a ~10000bps divergence.
    const v = sourcesDisagree({ intrinsic: 1, market: 1, oracle: 0 });
    expect(v.disagree).toBe(false);
    expect(v.maxSpreadBps).toBe(0); // oracle dropped → intrinsic+market agree
    expect(v.worstPair).toBe("intrinsic-market");
    expect(
      sourcesDisagree({ intrinsic: 1, market: 1, oracle: -1 }).disagree,
    ).toBe(false);
    // only a lone positive leg survives the >0 filter → <2 → fail safe
    expect(sourcesDisagree({ intrinsic: 0, market: 0, oracle: 1 })).toEqual({
      disagree: false,
      maxSpreadBps: null,
      worstPair: null,
    });
  });

  it("exports a sane default tolerance", () => {
    expect(SOURCES_DISAGREE_TOLERANCE_BPS).toBe(75);
  });
});
