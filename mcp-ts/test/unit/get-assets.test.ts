import { describe, it, expect, afterEach } from "vitest";
import { getAssetsTool } from "@/tools/get-assets";
import { getAssetStateTool } from "@/tools/get-asset-state";
import { handleGetAssetHistory } from "@/tools/get-asset-history";
import { ASSET_REGISTRY, isNonPublicSymbol, registryEntry } from "@/shared/asset-registry";
import { z } from "zod";
import { __cacheForTests } from "@/redis";
import type { DiscountSnapshot } from "@/shared/types";

function snap(asset: string, discount: string): DiscountSnapshot {
  const ts = Math.floor(Date.now() / 1000);
  return {
    asset,
    state: "PEGGED",
    discount,
    intrinsic_usd: "1",
    market_usd: "1",
    ts,
    updated_at: new Date(ts * 1000).toISOString(),
  };
}

describe("get_assets", () => {
  it("returns structuredContent with assets array + count", async () => {
    const res = await getAssetsTool.handler();
    expect(res.content).toBeInstanceOf(Array);
    expect(res.content[0]?.type).toBe("text");
    expect(res.structuredContent).toBeDefined();
    expect(Array.isArray(res.structuredContent.assets)).toBe(true);
    expect(res.structuredContent.count).toBe(res.structuredContent.assets.length);
  });

  it("content[0].text mirrors structuredContent as JSON", async () => {
    const res = await getAssetsTool.handler();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(Array.isArray(parsed.assets)).toBe(true);
    expect(typeof parsed.count).toBe("number");
  });

  afterEach(() => __cacheForTests.clear());

  // R2 audit idx 19: REST /v1/assets drops synth_lev (xSOL); MCP listed it as
  // PEGGED with a -36% "discount".
  it("excludes leveraged synthetics (xSOL) exactly like REST /v1/assets", async () => {
    __cacheForTests.set("jitoSOL", snap("jitoSOL", "0.0001"));
    __cacheForTests.set("xSOL", snap("xSOL", "-0.357918"));
    const res = await getAssetsTool.handler();
    const symbols = res.structuredContent.assets.map((a) => a.asset);
    expect(symbols).toContain("jitoSOL");
    expect(symbols).not.toContain("xSOL");
    expect(getAssetsTool.description).toMatch(/synth_lev/);
  });

  it("reports a stale snapshot as UNKNOWN with stale:true, and tolerates small future skew", async () => {
    const now = Math.floor(Date.now() / 1000);
    const at = (asset: string, ts: number): DiscountSnapshot => ({
      asset, state: "PEGGED", discount: "0.0001", intrinsic_usd: "1", market_usd: "1",
      ts, updated_at: new Date(ts * 1000).toISOString(),
    });
    __cacheForTests.set("jitoSOL", at("jitoSOL", now - 901));
    __cacheForTests.set("mSOL", at("mSOL", now + 30)); // skew within the grace
    __cacheForTests.set("INF", at("INF", now + 120)); // invalid future timestamp
    const res = await getAssetsTool.handler();
    const by = (s: string) => res.structuredContent.assets.find((a) => a.asset === s)!;
    expect(by("jitoSOL")).toMatchObject({ state: "UNKNOWN", stale: true });
    expect(by("jitoSOL").discount).toBe("0.0001"); // last-known value kept
    expect(by("mSOL")).toMatchObject({ state: "PEGGED", stale: false });
    expect(by("INF")).toMatchObject({ state: "UNKNOWN", stale: true });
  });

  // R3 audit R3-MCP-04: assets with no live snapshot were dropped (57 rows vs
  // REST's 67). REST /v1/assets lists every active, public asset
  // (`WHERE a.is_active`, synth_lev excluded), live or not.
  it("lists every active public asset like REST, UNKNOWN with nulls when there is no live snapshot", async () => {
    __cacheForTests.set("jitoSOL", snap("jitoSOL", "0.0001"));
    const res = await getAssetsTool.handler();
    const expected = ASSET_REGISTRY.filter((e) => e.active && !isNonPublicSymbol(e.symbol)).map(
      (e) => e.symbol,
    );
    const symbols = res.structuredContent.assets.map((a) => a.asset);
    expect(symbols).toEqual(expected);
    expect(res.structuredContent.count).toBe(expected.length);
    expect(symbols).not.toContain("BRZ"); // inactive in assets.toml

    const jito = res.structuredContent.assets.find((a) => a.asset === "jitoSOL")!;
    expect(jito.state).toBe("PEGGED");
    expect(jito.discount).toBe("0.0001");
    expect(jito.stale).toBe(false);

    const usdy = res.structuredContent.assets.find((a) => a.asset === "USDY")!;
    expect(usdy).toEqual({
      asset: "USDY",
      state: "UNKNOWN",
      discount: null,
      intrinsic_usd: null,
      market_usd: null,
      ts: null,
      updated_at: null,
      stale: true,
    });

    // The published output schema accepts the no-snapshot rows.
    const parsed = z.object(getAssetsTool.outputSchema).safeParse(res.structuredContent);
    expect(parsed.success).toBe(true);
  });

  // Review P3: a cached snapshot for an inactive registry row (active = false
  // in assets.toml) must not be appended as if it were a new asset.
  it("never lists an inactive registry asset, even with a cached snapshot", async () => {
    const inactive = ASSET_REGISTRY.filter((e) => !e.active).map((e) => e.symbol);
    expect(inactive).toEqual(expect.arrayContaining(["BRZ", "pbUSDC", "sharkSOL"]));
    for (const sym of inactive) __cacheForTests.set(sym, snap(sym, "0.0001"));
    const res = await getAssetsTool.handler();
    const symbols = res.structuredContent.assets.map((a) => a.asset);
    for (const sym of inactive) expect(symbols).not.toContain(sym);
    expect(res.structuredContent.count).toBe(
      ASSET_REGISTRY.filter((e) => e.active && !isNonPublicSymbol(e.symbol)).length,
    );
  });

  it("still lists a live asset that is not in this build's registry", async () => {
    __cacheForTests.set("newSOL", snap("newSOL", "0.0002"));
    const res = await getAssetsTool.handler();
    expect(res.structuredContent.assets.map((a) => a.asset)).toContain("newSOL");
  });

  // REST 404s xSOL on every /v1/assets route, so the per-symbol tools must not
  // serve it either.
  it("reports xSOL as not tracked in get_asset_state, get_asset_history and the registry", async () => {
    __cacheForTests.set("xSOL", snap("xSOL", "-0.357918"));
    const st = await getAssetStateTool.handler({ symbol: "xSOL" });
    expect(st.isError).toBe(true);
    expect(st.content[0]!.text).toMatch(/not tracked/);
    let fetched = false;
    const hist = await handleGetAssetHistory({ symbol: "xSOL", bucket: "1m", limit: 10 }, async () => {
      fetched = true;
      return [];
    });
    expect(hist.isError).toBe(true);
    expect(fetched).toBe(false);
    expect(registryEntry("xSOL")).toBeUndefined();
  });
});
