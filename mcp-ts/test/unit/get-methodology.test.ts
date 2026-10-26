import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getMethodologyTool, __test } from "@/tools/get-methodology";
import { ASSET_REGISTRY, isNonPublicSymbol } from "@/shared/asset-registry";

// get_methodology explains each asset from its REAL sources in assets.toml
// (generated registry), and only falls back to the REST class lookup for a
// symbol this build does not know. R1 audit idx 32 (wrong per-class copy) and
// idx 86 (429 cached as "class unknown").

describe("get_methodology", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    __test.classCache.clear();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function explain(symbol: string): Promise<string> {
    const res = await getMethodologyTool.handler({ symbol });
    return res.structuredContent!.explanation;
  }

  // Error text for a call that returns isError (no structuredContent).
  async function failure(symbol: string): Promise<string> {
    const res = await getMethodologyTool.handler({ symbol });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toBeUndefined();
    return res.content[0]!.text;
  }

  it("answers registry assets without any network call", async () => {
    const text = await explain("jitoSOL");
    expect(text).toMatch(/^Asset 'jitoSOL' \(lst\)/);
    expect(text).toMatch(/SPL stake-pool account/);
    expect(text).toMatch(/Jupiter swap quote against SOL, times Pyth SOL\/USD/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("USDS is not described as a Hylo CDP", async () => {
    const text = await explain("USDS");
    expect(text).toMatch(/\(stable_cdp\)/);
    expect(text).toMatch(/Intrinsic: fixed at \$1\./);
    expect(text).not.toMatch(/Hylo|hyUSD/);
  });

  it("USDC/USDT name their Pyth spot market, not a Jupiter quote", async () => {
    for (const sym of ["USDC", "USDT"]) {
      const text = await explain(sym);
      expect(text).toMatch(new RegExp(`Market: the Pyth ${sym}/USD spot price`));
      expect(text).not.toMatch(/Jupiter/);
    }
  });

  it("yield assets name their real market source (pyth_spot, dex_screener_usd)", async () => {
    expect(await explain("JLP")).toMatch(/Jupiter Perpetuals pool NAV[\s\S]*Pyth JLP\/USD spot price/);
    expect(await explain("USDY")).toMatch(/RWADynamicOracle[\s\S]*Jupiter swap quote/);
    expect(await explain("sUSDe")).toMatch(/ERC-4626[\s\S]*Pyth SUSDE\/USD spot price/);
    expect(await explain("EURC")).toMatch(/Kraken, Coinbase/);
    expect(await explain("USD*")).toMatch(/Perena's on-chain vault/);
    expect(await explain("sUSD")).toMatch(/DexScreener/);
    expect(await explain("hyUSD")).toMatch(/Hylo Exchange collateral ratio/);
  });

  it("every registry asset gets a specific, non-fallback explanation", async () => {
    for (const e of ASSET_REGISTRY) {
      if (isNonPublicSymbol(e.symbol)) continue; // xSOL: REST 404s it, so it is not explained
      const text = await explain(e.symbol);
      expect(text, e.symbol).not.toMatch(/class unknown|source '/);
      expect(text, e.symbol).toMatch(/Intrinsic: [\s\S]*Market: /);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the REST class for a symbol the registry lacks", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ class: "lst" }) });
    const text = await explain("brandNewSOL");
    expect(text).toMatch(/^Asset 'brandNewSOL' \(lst\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // R2 audit idx 23a: an unknown symbol is isError "not tracked", like
  // get_asset_state / get_loop_exposure / simulate_depeg_impact.
  it("returns isError 'not tracked' for an unknown symbol without caching the 404", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    expect(await failure("NOPE")).toMatch(/'NOPE' not tracked/);
    expect(await failure("NOPE")).toMatch(/'NOPE' not tracked/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bounds successful fallback lookups and evicts the least recently used entry", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ class: "lst" }) });
    for (let i = 0; i < 1_000; i++) await explain(`new${i}`);
    expect(__test.classCache.size).toBe(1_000);
    await explain("new0"); // refresh oldest entry
    await explain("new1000"); // evicts new1
    expect(__test.classCache.size).toBe(1_000);
    expect(__test.classCache.has("new0")).toBe(true);
    expect(__test.classCache.has("new1")).toBe(false);
    await explain("new1");
    expect(fetchMock).toHaveBeenCalledTimes(1_002);
  });

  it("does NOT cache a 429 or 5xx, and reports it as a transient error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });
    expect(await failure("brandNewSOL")).toMatch(/upstream HTTP 429\)\. Retry later/);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    expect(await failure("brandNewSOL")).toMatch(/upstream HTTP 503/);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ class: "lst" }) });
    expect(await explain("brandNewSOL")).toMatch(/\(lst\)/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT cache a 200 response that carries no class field", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await getMethodologyTool.handler({ symbol: "noClassSOL" });
    expect(__test.classCache.has("noClassSOL")).toBe(false);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ class: "lst" }) });
    expect(await explain("noClassSOL")).toMatch(/\(lst\)/);
    expect(__test.classCache.has("noClassSOL")).toBe(true);
  });

  it("does not poison the cache on a network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network blip"));
    expect(await failure("brandNewSOL")).toMatch(/upstream unreachable/);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ class: "lst" }) });
    expect(await explain("brandNewSOL")).toMatch(/\(lst\)/);
  });

  it("always points at the public methodology URL", async () => {
    const res = await getMethodologyTool.handler({ symbol: "jitoSOL" });
    expect(res.content[0]?.text).toMatch(/pegana\.xyz\/methodology/);
    expect(res.structuredContent!.methodology_url).toBe("https://pegana.xyz/methodology");
  });
});
