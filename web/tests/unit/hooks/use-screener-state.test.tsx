import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { AssetCardData } from "@/lib/api/types";

// -- next/navigation: a controllable URL, so setSort()'s ?sort=&dir= contract
// and the URL -> state round trip are both directly assertable. --
let mockSearch = "";
const replaceMock = vi.fn();
const pathnameMock = "/assets";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => pathnameMock,
}));

let mockAssets: AssetCardData[] | undefined = [];
const mutateMock = vi.fn();
vi.mock("@/lib/hooks/use-assets", () => ({
  useAssets: () => ({
    data: mockAssets,
    isLoading: false,
    error: undefined,
    mutate: mutateMock,
  }),
}));

vi.mock("@/lib/store/live-context", () => ({
  useLive: () => ({ byAsset: {}, connected: false }),
}));

import { useScreenerState } from "@/lib/hooks/use-screener-state";

function asset(overrides: Partial<AssetCardData>): AssetCardData {
  return {
    symbol: "USDC",
    name: "USD Coin",
    mint: "MintUSDC",
    class: "stable_fiat",
    peg_target: "USD",
    decimals: 6,
    state: "PEGGED",
    discount: "0.0001",
    intrinsic_usd: "1.0000",
    market_usd: "0.9999",
    risk_score: null,
    market_cap: null,
    circulating_supply: null,
    liquidity_usd: null,
    volume_24h_usd: null,
    holder_count: null,
    market_context_at: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  mockSearch = "";
  replaceMock.mockClear();
  mutateMock.mockClear();
  mockAssets = [];
});

describe("useScreenerState — stale rows sort last (H1/H9)", () => {
  // A row whose updated_at is well past STALE_AFTER_MS (15-min server-aligned
  // window) degrades to UNKNOWN + null bps. It carries a symbol that would
  // otherwise sort FIRST alphabetically and a discount that would otherwise read
  // as the biggest spread — both would put it at the top of some sort/direction
  // combo if the "stale sorts last" rule only special-cased one column, as the
  // pre-rebuild page did for "band" only.
  const staleIso = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const freshIso = new Date().toISOString();

  beforeEach(() => {
    mockAssets = [
      asset({
        symbol: "AAA", // alphabetically first
        discount: "0.05", // would read as the largest |spread| if not gated
        updated_at: staleIso,
      }),
      asset({ symbol: "BBB", discount: "0.001", updated_at: freshIso }),
      asset({ symbol: "CCC", discount: "0.002", updated_at: freshIso }),
    ];
  });

  it.each([
    ["spread", "desc"],
    ["spread", "asc"],
    ["symbol", "asc"],
    ["symbol", "desc"],
    ["band", "desc"],
    ["band", "asc"],
    ["state", "desc"],
    ["state", "asc"],
  ] as const)("sortKey=%s dir=%s: stale AAA is always last", (key, dir) => {
    mockSearch = `sort=${key}&dir=${dir}`;
    const { result } = renderHook(() => useScreenerState());
    const symbols = result.current.rows.map((r) => r.a.symbol);
    expect(symbols[symbols.length - 1]).toBe("AAA");
    expect(
      result.current.rows.find((r) => r.a.symbol === "AAA")?.bps,
    ).toBeNull();
    expect(result.current.rows.find((r) => r.a.symbol === "AAA")?.state).toBe(
      "UNKNOWN",
    );
  });
});

describe("useScreenerState — URL sort contract", () => {
  it("reads sortKey/sortDir straight off ?sort=&dir=", () => {
    mockSearch = "sort=symbol&dir=asc";
    const { result } = renderHook(() => useScreenerState());
    expect(result.current.sortKey).toBe("symbol");
    expect(result.current.sortDir).toBe("asc");
  });

  it("falls back to spread/desc for a missing or unrecognised sort key", () => {
    mockSearch = "sort=bogus&dir=asc";
    const { result } = renderHook(() => useScreenerState());
    expect(result.current.sortKey).toBe("spread");
    expect(result.current.sortDir).toBe("asc");
  });

  it("setSort() replaces the URL with the same ?sort=&dir= param names/values", () => {
    mockSearch = "sort=symbol&dir=asc";
    const { result } = renderHook(() => useScreenerState());

    act(() => result.current.setSort("safety"));

    expect(replaceMock).toHaveBeenCalledWith("/assets?sort=safety&dir=desc");
  });

  it("setSort() toggles direction when re-clicking the active column", () => {
    mockSearch = "sort=jitter&dir=desc";
    const { result } = renderHook(() => useScreenerState());

    act(() => result.current.setSort("jitter"));

    expect(replaceMock).toHaveBeenCalledWith("/assets?sort=jitter&dir=asc");
  });

  it("announces the new sort for the sr-only live region", () => {
    mockSearch = "sort=spread&dir=desc";
    const { result } = renderHook(() => useScreenerState());

    act(() => result.current.setSort("symbol"));

    expect(result.current.sortAnnounce).toBe("Sorted by Asset, ascending.");
  });
});

describe("useScreenerState — filter + search compose", () => {
  beforeEach(() => {
    mockAssets = [
      asset({ symbol: "jitoSOL", name: "Jito Staked SOL", class: "lst" }),
      asset({ symbol: "USDC", name: "USD Coin", class: "stable_fiat" }),
      asset({ symbol: "USDT", name: "Tether", class: "stable_fiat" }),
      asset({ symbol: "xSOL", name: "Hylo xSOL", class: "synth_lev" }),
    ];
  });

  it("applies the class filter alone", () => {
    const { result } = renderHook(() => useScreenerState());
    act(() => result.current.setClassFilter("stable"));
    expect(result.current.rows.map((r) => r.a.symbol).sort()).toEqual([
      "USDC",
      "USDT",
    ]);
  });

  it("applies class filter AND search together, not either/or", () => {
    const { result } = renderHook(() => useScreenerState());
    act(() => result.current.setClassFilter("stable"));
    act(() => result.current.setSearch("usdc"));
    expect(result.current.rows.map((r) => r.a.symbol)).toEqual(["USDC"]);
  });

  it("search alone matches symbol, name, or class case-insensitively", () => {
    const { result } = renderHook(() => useScreenerState());
    act(() => result.current.setSearch("tether"));
    expect(result.current.rows.map((r) => r.a.symbol)).toEqual(["USDT"]);
  });

  it("search also matches the eHYUSD display alias for sHYUSD", () => {
    // Local fixture (not the shared beforeEach one) so this asset's
    // stable_yield class doesn't perturb the sibling class-filter tests
    // above, which assert an exact stable-class asset count.
    mockAssets = [
      asset({ symbol: "USDC", name: "USD Coin", class: "stable_fiat" }),
      asset({
        symbol: "sHYUSD",
        name: "Staked Hylo USD",
        class: "stable_yield",
      }),
    ];
    const { result } = renderHook(() => useScreenerState());
    act(() => result.current.setSearch("ehyusd"));
    expect(result.current.rows.map((r) => r.a.symbol)).toEqual(["sHYUSD"]);
  });
});
