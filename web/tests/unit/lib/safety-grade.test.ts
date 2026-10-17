import { describe, expect, it } from "vitest";
import {
  MARKET_DEPTH_STALE_AFTER_MS,
  isMarketDepthUsable,
  safetyGrade,
  safetyRationale,
  safetyTotalGrade,
  type SafetyInput,
} from "@/lib/api/format";

const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const fresh = new Date(NOW - 10 * 60_000).toISOString(); // 10 min ago
const stale = new Date(NOW - MARKET_DEPTH_STALE_AFTER_MS - 60_000).toISOString();

function asset(overrides: Partial<SafetyInput> = {}): SafetyInput {
  return { symbol: "jitoSOL", class: "lst", ...overrides };
}

function depth(score: number | null, caps: string[] = []) {
  return { score, caps };
}

describe("isMarketDepthUsable", () => {
  it("requires both a score and a fresh observation timestamp", () => {
    expect(
      isMarketDepthUsable(
        asset({ market_depth: depth(90), market_context_at: fresh }),
        NOW,
      ),
    ).toBe(true);
    // No timestamp: cannot prove freshness, so not usable.
    expect(
      isMarketDepthUsable(asset({ market_depth: depth(90) }), NOW),
    ).toBe(false);
    // Null score (insufficient data upstream) is not usable.
    expect(
      isMarketDepthUsable(
        asset({ market_depth: depth(null), market_context_at: fresh }),
        NOW,
      ),
    ).toBe(false);
    // Stale observation is not usable.
    expect(
      isMarketDepthUsable(
        asset({ market_depth: depth(90), market_context_at: stale }),
        NOW,
      ),
    ).toBe(false);
    // Unparseable timestamp must not throw or pass.
    expect(
      isMarketDepthUsable(
        asset({ market_depth: depth(90), market_context_at: "not-a-date" }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("safetyGrade liquidity dimension", () => {
  it("uses real market depth when fresh", () => {
    const deep = safetyGrade(
      asset({ market_depth: depth(90), market_context_at: fresh }),
      NOW,
    );
    const mid = safetyGrade(
      asset({ market_depth: depth(50), market_context_at: fresh }),
      NOW,
    );
    const weak = safetyGrade(
      asset({ market_depth: depth(10), market_context_at: fresh }),
      NOW,
    );
    expect(deep.liquidity).toBe(3);
    expect(mid.liquidity).toBe(2);
    expect(weak.liquidity).toBe(1);
  });

  it("falls back to the class heuristic when depth is missing", () => {
    // USDC is in the legacy "deep" set.
    expect(safetyGrade(asset({ symbol: "USDC", class: "stable_fiat" }), NOW).liquidity).toBe(3);
    // BRZ is in LOW_LIQUIDITY_SYMBOLS.
    expect(safetyGrade(asset({ symbol: "BRZ", class: "stable_fx" }), NOW).liquidity).toBe(1);
    // Anything else lands in the generic middle bucket.
    expect(safetyGrade(asset({ symbol: "bbSOL", class: "lst" }), NOW).liquidity).toBe(2);
  });

  it("falls back to the heuristic when depth is stale, not to the stale number", () => {
    // A stale score of 10 must NOT drag jitoSOL to 1 — it degrades to the
    // heuristic instead, which is the honest behaviour for unusable data.
    const out = safetyGrade(
      asset({ symbol: "USDC", class: "stable_fiat", market_depth: depth(10), market_context_at: stale }),
      NOW,
    );
    expect(out.liquidity).toBe(3);
  });

  /**
   * The concrete error the hardcoded set made. Measured 2026-08-10: mSOL has
   * $5.58M of DEX liquidity, bbSOL has $96.1M — yet only mSOL was hardcoded
   * "deep". With real data the ordering inverts, which is the entire point.
   */
  it("inverts the hardcoded set's wrong ordering once real data arrives", () => {
    const msolLegacy = safetyGrade(asset({ symbol: "mSOL", class: "lst" }), NOW);
    const bbsolLegacy = safetyGrade(asset({ symbol: "bbSOL", class: "lst" }), NOW);
    expect(msolLegacy.liquidity).toBeGreaterThan(bbsolLegacy.liquidity); // the old, wrong answer

    const msolReal = safetyGrade(
      asset({ symbol: "mSOL", class: "lst", market_depth: depth(55), market_context_at: fresh }),
      NOW,
    );
    const bbsolReal = safetyGrade(
      asset({ symbol: "bbSOL", class: "lst", market_depth: depth(88), market_context_at: fresh }),
      NOW,
    );
    expect(bbsolReal.liquidity).toBeGreaterThan(msolReal.liquidity); // corrected
  });

  it("leaves peg and mechanism untouched by market depth", () => {
    const withDepth = safetyGrade(
      asset({ market_depth: depth(5), market_context_at: fresh }),
      NOW,
    );
    const withoutDepth = safetyGrade(asset(), NOW);
    expect(withDepth.peg).toBe(withoutDepth.peg);
    expect(withDepth.mechanism).toBe(withoutDepth.mechanism);
  });
});

describe("safetyRationale", () => {
  it("names the binding constraint when one fired", () => {
    const r = safetyRationale(
      asset({
        market_depth: depth(25, ["dormant market (24h volume under $1k)"]),
        market_context_at: fresh,
      }),
      NOW,
    );
    expect(r.liquidity).toContain("dormant market");
  });

  it("joins multiple constraints", () => {
    const r = safetyRationale(
      asset({
        market_depth: depth(20, [
          "dormant market (24h volume under $1k)",
          "concentrated holder base (35 holders)",
        ]),
        market_context_at: fresh,
      }),
      NOW,
    );
    expect(r.liquidity).toContain("dormant market");
    expect(r.liquidity).toContain("concentrated holder base");
  });

  it("labels the fallback path as a heuristic, never as a measurement", () => {
    const r = safetyRationale(asset({ symbol: "USDC", class: "stable_fiat" }), NOW);
    expect(r.liquidity).toContain("heuristic");
    expect(r.liquidity).not.toContain("Measured");
  });

  it("says 'measured' only on the real-data path", () => {
    const r = safetyRationale(
      asset({ market_depth: depth(90), market_context_at: fresh }),
      NOW,
    );
    expect(r.liquidity).toContain("Measured");
  });

  /** DESIGN.md bans visible em-dashes across every product surface. */
  it("emits no em-dashes in any rationale branch", () => {
    const branches: SafetyInput[] = [
      asset({ market_depth: depth(90), market_context_at: fresh }),
      asset({ market_depth: depth(50), market_context_at: fresh }),
      asset({ market_depth: depth(10), market_context_at: fresh }),
      asset({ market_depth: depth(20, ["thin market (liquidity under $50k)"]), market_context_at: fresh }),
      asset({ symbol: "USDC", class: "stable_fiat" }),
      asset({ symbol: "BRZ", class: "stable_fx" }),
      asset({ symbol: "bbSOL", class: "lst" }),
    ];
    for (const a of branches) {
      for (const text of Object.values(safetyRationale(a, NOW))) {
        expect(text).not.toContain("—");
      }
    }
  });
});

describe("safetyTotalGrade", () => {
  it("still maps the dot sum onto A/B/C/D", () => {
    expect(safetyTotalGrade({ peg: 3, liquidity: 3, mechanism: 3 })).toBe("A");
    expect(safetyTotalGrade({ peg: 2, liquidity: 2, mechanism: 2 })).toBe("B");
    expect(safetyTotalGrade({ peg: 2, liquidity: 1, mechanism: 2 })).toBe("C");
    expect(safetyTotalGrade({ peg: 1, liquidity: 1, mechanism: 1 })).toBe("D");
  });

  it("lets a real thin-liquidity reading actually lower the overall grade", () => {
    const base = asset({ symbol: "someLST", class: "lst" });
    const heuristic = safetyTotalGrade(safetyGrade(base, NOW));
    const measuredThin = safetyTotalGrade(
      safetyGrade({ ...base, market_depth: depth(8), market_context_at: fresh }, NOW),
    );
    expect(heuristic).toBe("A");
    expect(measuredThin).toBe("B");
  });
});
