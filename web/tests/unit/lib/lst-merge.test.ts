import { describe, expect, it } from "vitest";
import { buildFallbackRows, mergeLstDirectory } from "@/lib/lst/merge";
import type { DirectoryLstRaw } from "@/lib/lst/types";
import type { AssetCardData } from "@/lib/api/types";

function directoryRow(
  overrides: Partial<DirectoryLstRaw> = {},
): DirectoryLstRaw {
  return {
    mint: "MintA",
    symbol: "aSOL",
    name: "A Staked SOL",
    logoUri: "https://example.com/a.png",
    poolProgram: "Spl",
    tvlUsd: 1000,
    apy: 0.05,
    rate: 1.1,
    flags: { deprecated: false, dead: false, stale: false },
    ...overrides,
  };
}

function peganaAsset(overrides: Partial<AssetCardData> = {}): AssetCardData {
  return {
    symbol: "aSOL",
    name: "A Staked SOL",
    mint: "MintA",
    class: "lst",
    peg_target: "SOL",
    decimals: 9,
    state: "PEGGED",
    discount: "0.001",
    intrinsic_usd: "100",
    market_usd: "99.9",
    risk_score: null,
    market_cap: null,
    circulating_supply: null,
    liquidity_usd: null,
    volume_24h_usd: null,
    holder_count: null,
    market_context_at: null,
    updated_at: "2026-07-15T00:00:00Z",
    ...overrides,
  };
}

describe("mergeLstDirectory", () => {
  it("matches on mint and overlays the live Pegana verdict", () => {
    const rows = mergeLstDirectory([directoryRow()], [peganaAsset()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].covered).toBe(true);
    expect(rows[0].state).toBe("PEGGED");
    expect(rows[0].peganaSymbol).toBe("aSOL");
    expect(rows[0].spreadBps).not.toBeNull();
    // Directory-only fields pass through untouched.
    expect(rows[0].tvlUsd).toBe(1000);
    expect(rows[0].apy).toBe(0.05);
    expect(rows[0].logoUri).toBe("https://example.com/a.png");
  });

  it("signs the spread the holder way: + for a premium (market above NAV), − for a discount", () => {
    // A healthy LST trading ABOVE its staked-SOL value is a premium → must
    // read `+`, not a scary `−`. Pegana's internal `discount` field signs this
    // the opposite way (premium = negative); merge flips it for the holder row.
    const premium = mergeLstDirectory(
      [directoryRow()],
      [
        peganaAsset({
          intrinsic_usd: "100",
          market_usd: "101",
          discount: "-0.01",
        }),
      ],
    );
    expect(premium[0].spreadBps).toBeGreaterThan(0);

    const discount = mergeLstDirectory(
      [directoryRow()],
      [
        peganaAsset({
          intrinsic_usd: "100",
          market_usd: "99",
          discount: "0.01",
        }),
      ],
    );
    expect(discount[0].spreadBps).toBeLessThan(0);
  });

  it("falls back to a case-insensitive symbol match when the mint doesn't line up", () => {
    const rows = mergeLstDirectory(
      [directoryRow({ mint: "DirectoryMint", symbol: "JitoSOL" })],
      [
        peganaAsset({
          mint: "PeganaMintDifferent",
          symbol: "jitoSOL",
          state: "DRIFT",
        }),
      ],
    );
    expect(rows[0].covered).toBe(true);
    expect(rows[0].state).toBe("DRIFT");
    expect(rows[0].peganaSymbol).toBe("jitoSOL");
  });

  it("marks a directory LST Pegana doesn't track as not-yet-rated, never fabricating a state", () => {
    // dSOL: real-world case — still listed on lst-directory.com, but removed
    // from Pegana's own tracked universe after the Drift exploit.
    const rows = mergeLstDirectory(
      [directoryRow({ mint: "DeadMint", symbol: "dSOL" })],
      [peganaAsset()], // only aSOL tracked
    );
    expect(rows[0].covered).toBe(false);
    expect(rows[0].state).toBeNull();
    expect(rows[0].peganaSymbol).toBeNull();
    expect(rows[0].spreadBps).toBeNull();
  });

  it("ignores non-LST Pegana assets when building the match maps (no cross-class collisions)", () => {
    const rows = mergeLstDirectory(
      [directoryRow({ mint: "MintA", symbol: "aSOL" })],
      [peganaAsset({ class: "stable_fiat" })],
    );
    expect(rows[0].covered).toBe(false);
  });

  it("carries the deprecated/dead flags through untouched", () => {
    const rows = mergeLstDirectory(
      [
        directoryRow({
          flags: { deprecated: true, dead: false, stale: false },
        }),
        directoryRow({
          mint: "MintB",
          symbol: "bSOL",
          flags: { deprecated: false, dead: true, stale: false },
        }),
      ],
      [],
    );
    expect(rows[0].deprecated).toBe(true);
    expect(rows[0].dead).toBe(false);
    expect(rows[1].dead).toBe(true);
  });

  it("sorts by TVL descending, with missing-TVL rows sinking to the bottom", () => {
    const rows = mergeLstDirectory(
      [
        directoryRow({ mint: "M1", symbol: "s1", tvlUsd: 100 }),
        directoryRow({ mint: "M2", symbol: "s2", tvlUsd: null }),
        directoryRow({ mint: "M3", symbol: "s3", tvlUsd: 5_000_000 }),
      ],
      [],
    );
    expect(rows.map((r) => r.symbol)).toEqual(["s3", "s1", "s2"]);
  });
});

describe("buildFallbackRows", () => {
  it("builds an every-row-covered universe from Pegana's own LST assets, alphabetically sorted", () => {
    const rows = buildFallbackRows([
      peganaAsset({ symbol: "bSOL", mint: "MintB" }),
      peganaAsset({ symbol: "aSOL", mint: "MintA" }),
      peganaAsset({ symbol: "usdc-not-lst", class: "stable_fiat" }),
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(["aSOL", "bSOL"]);
    expect(rows.every((r) => r.covered)).toBe(true);
    expect(rows.every((r) => r.tvlUsd === null)).toBe(true);
  });
});
