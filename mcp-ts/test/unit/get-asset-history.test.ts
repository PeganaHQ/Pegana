import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { getAssetHistoryTool, handleGetAssetHistory } from "@/tools/get-asset-history";
import { HistoryOverloadError } from "@/db";

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

  it("rejects limit 5001 and accepts 5000 at the schema", () => {
    const input = z.object(getAssetHistoryTool.inputSchema);
    expect(input.safeParse({ symbol: "jitoSOL", limit: 5001 }).success).toBe(false);
    expect(input.safeParse({ symbol: "jitoSOL", limit: 5000 }).success).toBe(true);
  });

  it("passes null USD legs through (a bucket without a raw row)", async () => {
    const res = await handleGetAssetHistory(
      { symbol: "jitoSOL", bucket: "1m", limit: 10 },
      vi.fn().mockResolvedValue([
        { ts: "2026-05-26T00:00:00.000Z", discount: "-0.0034", intrinsic_usd: null, market_usd: null },
      ]),
    );
    expect(res.isError).toBeUndefined();
    const out = z.object(getAssetHistoryTool.outputSchema).safeParse(res.structuredContent);
    expect(out.success).toBe(true);
  });

  it.each([
    ["a statement timeout (57014)", Object.assign(new Error("canceling statement due to statement timeout SELECT secret"), { code: "57014" })],
    ["a pool connection timeout", new Error("timeout exceeded when trying to connect")],
    ["a saturated pool", new HistoryOverloadError()],
  ])("maps %s to a retry error without driver text", async (_n, err) => {
    const res = await handleGetAssetHistory(
      { symbol: "jitoSOL", bucket: "1m", limit: 10 },
      vi.fn().mockRejectedValue(err),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/temporarily overloaded, retry/);
    expect(res.content[0]!.text).not.toMatch(/SELECT|statement|57014|connect/);
  });

  it("still throws on an unrelated error", async () => {
    await expect(
      handleGetAssetHistory(
        { symbol: "jitoSOL", bucket: "1m", limit: 10 },
        vi.fn().mockRejectedValue(new Error("boom")),
      ),
    ).rejects.toThrow("boom");
  });
});
