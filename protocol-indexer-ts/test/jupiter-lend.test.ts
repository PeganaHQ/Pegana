import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJupiterLendExposure } from "../src/sources/jupiter-lend";

const JITO_MINT = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// One borrow vault: jitoSOL collateral (1000 tokens @ $100 = $100k) → USDC debt
// (50,000 tokens @ $1 = $50k), 73 positions.
const VAULT = {
  supplyToken: { address: JITO_MINT, decimals: 9, price: "100" },
  borrowToken: { address: USDC_MINT, decimals: 6, price: "1" },
  totalSupply: "1000000000000", // 1000 * 1e9
  totalBorrow: "50000000000", // 50000 * 1e6
  totalPositions: 73,
};

afterEach(() => vi.unstubAllGlobals());

describe("fetchJupiterLendExposure", () => {
  it("converts vault totals to USD per tracked mint and k-floors the count", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([VAULT]), { status: 200 })));
    const rows = await fetchJupiterLendExposure([
      { symbol: "jitoSOL", mint: JITO_MINT },
      { symbol: "USDC", mint: USDC_MINT },
    ]);
    const jito = rows.find((r) => r.asset === "jitoSOL");
    expect(jito!.collateral_lev_usd).toBe("100000"); // 1000 * $100
    expect(jito!.position_bucket).toBe(">50"); // 73 → range, never raw
    expect(jito!.protocol).toBe("jupiter_lend");

    const usdc = rows.find((r) => r.asset === "USDC");
    expect(usdc!.debt_usd).toBe("50000"); // 50000 * $1 borrowed
    expect(usdc!.collateral_lev_usd).toBe("0"); // USDC is debt here, not collateral
  });

  it("returns [] when the vaults endpoint is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const rows = await fetchJupiterLendExposure([{ symbol: "SOL", mint: "So11111111111111111111111111111111111111112" }]);
    expect(rows).toHaveLength(0);
  });
});
