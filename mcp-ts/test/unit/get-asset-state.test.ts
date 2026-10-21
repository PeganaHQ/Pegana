import { describe, it, expect } from "vitest";
import { getAssetStateTool } from "@/tools/get-asset-state";

describe("get_asset_state", () => {
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
