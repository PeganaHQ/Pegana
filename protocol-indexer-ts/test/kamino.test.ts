import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchKaminoExposure } from "../src/sources/kamino";

// Minimal fixture mirroring the live Kamino REST shape (see dry-run against
// api.kamino.finance). One deposit reserve (jitoSOL) + one borrow reserve (SOL),
// one leverage pair, so the join is deterministic.
const MKT = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const JITO_MINT = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const SOL_MINT = "So11111111111111111111111111111111111111112";

function mockFetch(url: string): Response {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200 }) as Response;
  if (url.endsWith("/kamino-market")) return json([{ lendingMarket: MKT, isPrimary: true }]);
  if (url.endsWith("/reserves/metrics"))
    return json([
      { reserve: "RJITO", liquidityToken: "JITOSOL", liquidityTokenMint: JITO_MINT, totalSupplyUsd: "6000000" },
      { reserve: "RSOL", liquidityToken: "SOL", liquidityTokenMint: SOL_MINT, totalSupplyUsd: "9000000" },
    ]);
  if (url.endsWith("/leverage/metrics"))
    return json([
      { depositReserve: "RJITO", borrowReserve: "RSOL", totalDepositedUsd: "5592528", totalBorrowedUsd: "1821", totalObligations: 73 },
    ]);
  throw new Error(`unexpected fetch ${url}`);
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchKaminoExposure", () => {
  it("joins reserves+leverage per Pegana-tracked mint and k-floors the count", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => mockFetch(u)));
    const rows = await fetchKaminoExposure([
      { symbol: "jitoSOL", mint: JITO_MINT },
      { symbol: "SOL", mint: SOL_MINT },
    ]);
    const jito = rows.find((r) => r.asset === "jitoSOL");
    expect(jito).toBeTruthy();
    expect(jito!.collateral_lev_usd).toBe("5592528");
    expect(jito!.collateral_usd).toBe("6000000"); // total supply, not just leverage
    expect(jito!.position_bucket).toBe(">50"); // 73 obligations → k-floored range, NEVER "73"
    expect(jito!.loop_basis).toBe("typed");
    expect(jito!.protocol).toBe("kamino");

    const sol = rows.find((r) => r.asset === "SOL");
    expect(sol!.debt_usd).toBe("1821"); // SOL is the borrow (short) leg
  });

  it("emits no row for a tracked asset with zero Kamino leverage", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => mockFetch(u)));
    const rows = await fetchKaminoExposure([
      { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    ]);
    expect(rows).toHaveLength(0);
  });
});
