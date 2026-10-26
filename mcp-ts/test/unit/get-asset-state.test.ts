import { describe, it, expect } from "vitest";
import { getAssetStateTool } from "@/tools/get-asset-state";
import { __cacheForTests } from "@/redis";

describe("get_asset_state", () => {
  it("does not carry an old state as the current state when stale", async () => {
    const now = Math.floor(Date.now() / 1000);
    __cacheForTests.set("USDC", {
      asset: "USDC", state: "PEGGED", discount: "0", intrinsic_usd: "1",
      market_usd: "1", ts: now - 901, updated_at: new Date((now - 901) * 1000).toISOString(),
    });
    try {
      const res = await getAssetStateTool.handler({ symbol: "USDC" });
      expect(res.isError).toBe(true);
      expect(res.structuredContent).toBeUndefined();
      expect(res.content[0]!.text).not.toContain("PEGGED");
    } finally {
      __cacheForTests.delete("USDC");
    }
  });
  it("tolerates up to 60 s of future skew but rejects more, clamping lastFreshSec at 0", async () => {
    const now = Math.floor(Date.now() / 1000);
    const put = (ts: number) =>
      __cacheForTests.set("USDC", {
        asset: "USDC", state: "PEGGED", discount: "0", intrinsic_usd: "1",
        market_usd: "1", ts, updated_at: new Date(ts * 1000).toISOString(),
      });
    try {
      put(now + 30);
      expect((await getAssetStateTool.handler({ symbol: "USDC" })).isError).toBeUndefined();
      put(now + 300);
      const res = await getAssetStateTool.handler({ symbol: "USDC" });
      expect(res.isError).toBe(true);
      expect(res._meta).toMatchObject({ state: "UNKNOWN", lastFreshSec: 0 });
    } finally {
      __cacheForTests.delete("USDC");
    }
  });
  it("returns isError when asset is not in cache", async () => {
    const res = await getAssetStateTool.handler({ symbol: "ZZZ_NOT_REAL" });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/not tracked/i);
  });
});

describe("get_asset_state missing-snapshot wording (R1 audit idx 85)", () => {
  it("says a tracked asset without a snapshot is tracked, not 'not tracked'", async () => {
    for (const symbol of ["EURC", "sUSDe", "sUSD"]) {
      const res = await getAssetStateTool.handler({ symbol });
      expect(res.isError).toBe(true);
      expect(res.content[0]?.text).toMatch(/is tracked but has no live snapshot yet/);
      expect(res.content[0]?.text).not.toMatch(/not tracked/);
    }
  });

  it("does not list sUSDe among the example symbols", () => {
    expect(getAssetStateTool.inputSchema.symbol.description).not.toMatch(/sUSDe/);
  });
});
