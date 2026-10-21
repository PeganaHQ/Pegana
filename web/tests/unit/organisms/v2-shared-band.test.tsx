import { describe, expect, it } from "vitest";
import * as shared from "@/components/organisms/v2/shared";
import {
  boardGaugePct,
  selectBoardRows,
} from "@/components/organisms/v2/shared";
import type { AssetCardData } from "@/lib/api/types";

// Hero peg board data layer. Guards three audit findings:
//  - no invented rows: there is no sample/fallback row set to fall back to;
//  - "Band proximity" is computed from each asset's own thresholds (it used to
//    be a constant 8% for every PEGGED row);
//  - selection is worst first (DRIFT+ before UNKNOWN before PEGGED), with
//    UNKNOWN capped at one row (null states used to crowd out the only DRIFT).

const NOW = Date.parse("2026-10-20T12:00:00Z");
const FRESH = new Date(NOW - 30_000).toISOString();

const BANDS = { drift_bps: 55, depeg_bps: 140, critical_bps: 300 };

let n = 0;
function mkAsset(overrides: Partial<AssetCardData>): AssetCardData {
  n += 1;
  return {
    symbol: `A${n}`,
    name: `Asset ${n}`,
    mint: `mint${n}`,
    class: "lst",
    peg_target: "SOL",
    decimals: 9,
    state: "PEGGED",
    discount: null,
    intrinsic_usd: "100.00",
    market_usd: "100.00",
    risk_score: null,
    market_cap: null,
    circulating_supply: null,
    liquidity_usd: null,
    volume_24h_usd: null,
    holder_count: null,
    market_context_at: null,
    updated_at: FRESH,
    thresholds: BANDS,
    ...overrides,
  };
}

describe("hero board never ships invented rows", () => {
  it("exports no sample row set or sample sparkline generator", () => {
    expect("SAMPLE_BOARD_ROWS" in shared).toBe(false);
    expect("sampleSparkSeries" in shared).toBe(false);
  });

  it("selectBoardRows returns nothing (not a fallback) without live data", () => {
    expect(selectBoardRows(undefined, NOW)).toEqual([]);
    expect(selectBoardRows([], NOW)).toEqual([]);
  });
});

describe("boardGaugePct: real proximity to the asset's own depeg line", () => {
  it("uses the served thresholds: a 9.5 bps discount vs a 140 bps depeg line is 7%", () => {
    expect(boardGaugePct(mkAsset({}), "PEGGED", 9.5)).toBe(7);
  });

  it("differs between assets with the same state (no constant per state)", () => {
    const tight = mkAsset({
      class: "stable_fiat",
      thresholds: { drift_bps: 25, depeg_bps: 100, critical_bps: 300 },
    });
    expect(boardGaugePct(tight, "PEGGED", 4)).toBe(4);
    expect(boardGaugePct(tight, "PEGGED", 20)).toBe(20);
  });

  it("clamps beyond the depeg line to 100", () => {
    expect(boardGaugePct(mkAsset({}), "CRITICAL", 900)).toBe(100);
  });

  it("a premium on a direction-sensitive class (lst, stable_yield) or synth_lev reads 0", () => {
    expect(boardGaugePct(mkAsset({ class: "lst" }), "DRIFT", -105)).toBe(0);
    expect(boardGaugePct(mkAsset({ class: "stable_yield" }), "DEPEG", -300)).toBe(0);
    expect(boardGaugePct(mkAsset({ class: "synth_lev" }), "PEGGED", -50)).toBe(0);
  });

  it("a premium on a symmetric class counts by magnitude", () => {
    expect(boardGaugePct(mkAsset({ class: "stable_fiat" }), "DRIFT", -70)).toBe(50);
  });

  it("UNKNOWN or a missing spread has no reading", () => {
    expect(boardGaugePct(mkAsset({}), "UNKNOWN", 10)).toBeNull();
    expect(boardGaugePct(mkAsset({}), "PEGGED", null)).toBeNull();
  });
});

describe("selectBoardRows (live path): a premium LST reads calm end-to-end", () => {
  it("a ~+1.05% LST premium gets 0 proximity, a '+' spread and no amber tint, even while the committed state says DRIFT", () => {
    const asset = mkAsset({
      state: "DRIFT",
      intrinsic_usd: "189.00",
      market_usd: "190.99",
    });
    const [row] = selectBoardRows([asset], NOW, 1);
    expect(row.spreadLabel).toBe("+1.05%");
    expect(row.gaugePct).toBe(0);
    expect(row.amberTint).toBe(false);
  });

  it("control: a genuine LST discount of the same size is NOT carved out", () => {
    const asset = mkAsset({
      state: "DRIFT",
      intrinsic_usd: "190.99",
      market_usd: "189.00",
    });
    const [row] = selectBoardRows([asset], NOW, 1);
    expect(parseFloat(row.spreadLabel)).toBeLessThan(0);
    expect(row.gaugePct).toBe(74); // 104 bps of a 140 bps depeg line
    expect(row.amberTint).toBe(true);
  });

  it("a stale snapshot renders as Unknown with no proximity", () => {
    const asset = mkAsset({
      state: "PEGGED",
      updated_at: new Date(NOW - 60 * 60_000).toISOString(),
    });
    const [row] = selectBoardRows([asset], NOW, 1);
    expect(row.state).toBe("UNKNOWN");
    expect(row.gaugePct).toBeNull();
  });
});

describe("selectBoardRows: worst first", () => {
  it("reproduces the audited board: the only DRIFT asset is shown first and null-state assets take one slot, not three", () => {
    const assets: AssetCardData[] = [
      mkAsset({ symbol: "BNSOL", class: "lst" }),
      mkAsset({ symbol: "BulkSOL", class: "lst" }),
      mkAsset({ symbol: "AUSD", class: "stable_fiat", state: null }),
      mkAsset({ symbol: "CASH", class: "stable_fiat" }),
      mkAsset({ symbol: "USDC", class: "stable_fiat" }),
      mkAsset({ symbol: "USDS", class: "stable_cdp" }),
      mkAsset({ symbol: "JupUSD", class: "stable_dn" }),
      mkAsset({ symbol: "EURC", class: "stable_fx", state: null }),
      mkAsset({ symbol: "sUSD", class: "stable_yield", state: "UNKNOWN" }),
      mkAsset({
        symbol: "sHYUSD",
        class: "stable_yield",
        state: "DRIFT",
        intrinsic_usd: "1.0000",
        market_usd: "0.9728",
      }),
      mkAsset({ symbol: "JLP", class: "synth_lev", state: null }),
      mkAsset({ symbol: "xSOL", class: "synth_lev" }),
    ];
    const rows = selectBoardRows(assets, NOW, 8);
    expect(rows).toHaveLength(8);
    expect(rows[0].symbol).toBe("sHYUSD");
    expect(rows.filter((r) => r.state === "UNKNOWN")).toHaveLength(1);
    expect(rows[1].state).toBe("UNKNOWN");
    expect(rows.slice(2).every((r) => r.state === "PEGGED")).toBe(true);
  });

  it("orders alerting rows CRITICAL > DEPEG > DRIFT, then by proximity", () => {
    const assets = [
      mkAsset({ symbol: "d1", state: "DRIFT", market_usd: "99.30" }),
      mkAsset({ symbol: "d2", state: "DRIFT", market_usd: "99.10" }),
      mkAsset({ symbol: "c", state: "CRITICAL", market_usd: "96.00" }),
      mkAsset({ symbol: "p", state: "DEPEG", market_usd: "98.50" }),
      mkAsset({ symbol: "ok" }),
    ];
    expect(selectBoardRows(assets, NOW, 5).map((r) => r.symbol)).toEqual([
      "c",
      "p",
      "d2",
      "d1",
      "ok",
    ]);
  });

  it("keeps one UNKNOWN visible even when alerting rows would fill the board", () => {
    const assets = [
      ...Array.from({ length: 9 }, () => mkAsset({ state: "DRIFT", market_usd: "99.00" })),
      mkAsset({ symbol: "unk", state: null }),
    ];
    const rows = selectBoardRows(assets, NOW, 8);
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.symbol)).toContain("unk");
  });

  it("only back-fills extra UNKNOWN rows when there is nothing else to show", () => {
    const assets = [
      mkAsset({ symbol: "u1", state: null }),
      mkAsset({ symbol: "u2", state: "UNKNOWN" }),
      mkAsset({ symbol: "p1" }),
    ];
    expect(selectBoardRows(assets, NOW, 8).map((r) => r.symbol)).toEqual([
      "u1",
      "p1",
      "u2",
    ]);
  });

  it("the filter narrows the universe before selection", () => {
    const assets = [
      mkAsset({ symbol: "lst1", class: "lst" }),
      mkAsset({ symbol: "fiat1", class: "stable_fiat" }),
      mkAsset({ symbol: "cdp1", class: "stable_cdp" }),
      mkAsset({ symbol: "y1", class: "stable_yield" }),
      mkAsset({ symbol: "x1", class: "synth_lev" }),
    ];
    const pick = (f: shared.BoardFilter) =>
      selectBoardRows(assets, NOW, 8, f).map((r) => r.symbol).sort();
    expect(pick("lsts")).toEqual(["lst1"]);
    expect(pick("stables")).toEqual(["cdp1", "fiat1"]);
    expect(pick("yield")).toEqual(["y1"]);
    expect(pick("all")).toHaveLength(5);
  });
});

describe("collateral-ratio-banded assets (hyUSD)", () => {
  // Live /v1/assets shape on 2026-10-21: CR bands, no *_bps keys.
  const CR = { cr_drift: 130, cr_depeg: 115, cr_critical: 105, cr_black_swan: 100 };
  const hyusd = () =>
    mkAsset({
      symbol: "hyUSD",
      class: "stable_cdp",
      peg_target: "USD",
      thresholds: CR as unknown as AssetCardData["thresholds"],
    });

  it("has no spread proximity: never the class-fallback 23%", () => {
    // -0.17% used to read 17.46/75 = 23% against stable_cdp's fallback line.
    expect(boardGaugePct(hyusd(), "PEGGED", 17.46)).toBeNull();
  });

  it("the board row says it is CR-banded instead of hiding the row's data", () => {
    const [row] = selectBoardRows([hyusd()], NOW);
    expect(row.gaugePct).toBeNull();
    expect(row.crBand).toBe(true);
  });

  it("bps-banded assets are not flagged", () => {
    const [row] = selectBoardRows([mkAsset({})], NOW);
    expect(row.crBand).toBe(false);
  });
});
