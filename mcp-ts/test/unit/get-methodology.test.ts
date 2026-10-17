import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getMethodologyTool, __test } from "@/tools/get-methodology";

// B-010 regression: get_methodology must now resolve AssetClass via REST
// /v1/assets/{symbol} and return the class-specific explainer. Before
// 2026-05-29 it always returned the "class unknown to this MCP server"
// fallback because the registry wasn't loaded.

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

  it("returns the class-specific explainer when the API resolves the symbol", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ class: "lst" }),
    });
    const res = await getMethodologyTool.handler({ symbol: "jitoSOL" });
    expect(res.content[0]?.text).toMatch(/jitoSOL/);
    // LST blurb mentions Sanctum + Pyth — not the generic fallback.
    expect(res.content[0]?.text).toMatch(/Sanctum/);
    expect(res.content[0]?.text).not.toMatch(/class unknown/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the fallback prose when the symbol is unknown", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    const res = await getMethodologyTool.handler({ symbol: "NOPE" });
    expect(res.content[0]?.text).toMatch(/class unknown/);
  });

  it("memoizes the class lookup for the cache window", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ class: "stable_fiat" }) });
    await getMethodologyTool.handler({ symbol: "USDC" });
    await getMethodologyTool.handler({ symbol: "USDC" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not poison the cache on a network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network blip"));
    const res1 = await getMethodologyTool.handler({ symbol: "jitoSOL" });
    expect(res1.content[0]?.text).toMatch(/class unknown/);
    // Next call retries because the previous error wasn't cached.
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ class: "lst" }) });
    const res2 = await getMethodologyTool.handler({ symbol: "jitoSOL" });
    expect(res2.content[0]?.text).toMatch(/Sanctum/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("always points at the public methodology URL", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ class: "lst" }) });
    const res = await getMethodologyTool.handler({ symbol: "jitoSOL" });
    expect(res.content[0]?.text).toMatch(/pegana\.xyz\/methodology/);
    expect(res.structuredContent.methodology_url).toBe("https://pegana.xyz/methodology");
  });
});
