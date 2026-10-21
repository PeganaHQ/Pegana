import { describe, it, expect, afterEach } from "vitest";
import { getAssetsTool } from "@/tools/get-assets";
import { getAssetStateTool } from "@/tools/get-asset-state";
import { handleGetAssetHistory } from "@/tools/get-asset-history";
import { registryEntry } from "@/shared/asset-registry";
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
    expect(symbols).toEqual(["jitoSOL"]);
    expect(res.structuredContent.count).toBe(1);
    expect(getAssetsTool.description).toMatch(/synth_lev/);
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
