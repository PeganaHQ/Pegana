import { describe, it, expect } from "vitest";
import { getAssetStateTool } from "@/tools/get-asset-state";

describe("get_asset_state", () => {
  it("returns isError when asset is not in cache", async () => {
    const res = await getAssetStateTool.handler({ symbol: "ZZZ_NOT_REAL" });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/not tracked/i);
  });
});
