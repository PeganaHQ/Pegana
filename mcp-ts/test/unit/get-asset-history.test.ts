import { describe, it, expect, vi } from "vitest";
import { handleGetAssetHistory } from "@/tools/get-asset-history";

const fetchHistory = vi.fn().mockResolvedValue([
    {
      ts: "2026-05-26T00:00:00Z",
      discount: "-0.0034",
      intrinsic_usd: "1.0",
      market_usd: "0.9966",
    },
]);

describe("get_asset_history", () => {
  it("returns structuredContent with rows + count + echoed symbol/bucket", async () => {
    const res = await handleGetAssetHistory(
      {
        symbol: "jitoSOL",
        bucket: "1m",
        limit: 10,
      },
      fetchHistory,
    );
    expect(res.structuredContent).toBeDefined();
    expect(res.structuredContent!.symbol).toBe("jitoSOL");
    expect(res.structuredContent!.bucket).toBe("1m");
    expect(res.structuredContent!.count).toBe(1);
    expect(res.structuredContent!.rows[0]!.discount).toBe("-0.0034");
  });

  it("content[0].text mirrors structuredContent as JSON", async () => {
    const res = await handleGetAssetHistory(
      {
        symbol: "jitoSOL",
        bucket: "1m",
        limit: 10,
      },
      fetchHistory,
    );
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.rows[0].discount).toBe("-0.0034");
    expect(parsed.symbol).toBe("jitoSOL");
  });

  it("errors like the other tools for an unknown symbol with no rows", async () => {
    const res = await handleGetAssetHistory(
      { symbol: "NOPE", bucket: "1m", limit: 10 },
      vi.fn().mockResolvedValue([]),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/'NOPE' not tracked/);
  });

  it("returns an empty series (not an error) for a tracked symbol with no rows", async () => {
    const res = await handleGetAssetHistory(
      { symbol: "EURC", bucket: "1m", limit: 10 },
      vi.fn().mockResolvedValue([]),
    );
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent!.count).toBe(0);
  });
});
