import { describe, expect, it } from "vitest";
import { parseDirectoryRows } from "@/lib/lst/parse";

describe("parseDirectoryRows", () => {
  it("parses a well-formed row, dropping fields the page doesn't use", () => {
    const rows = parseDirectoryRows([
      {
        mint: "MintA",
        symbol: "aSOL",
        name: "A Staked SOL",
        logoUri: "https://example.com/a.png",
        poolProgram: "Spl",
        tvlUsd: 1234.5,
        apy: 0.05,
        rate: 1.1,
        flags: { deprecated: false, dead: false, stale: false, isNew: false },
        holders: 999,
        apyHistory: [{ epoch: 1, apy: 0.05, rate: 1.1 }],
        breakdown: { realized: 0.05 },
      },
    ]);
    expect(rows).toEqual([
      {
        mint: "MintA",
        symbol: "aSOL",
        name: "A Staked SOL",
        logoUri: "https://example.com/a.png",
        poolProgram: "Spl",
        tvlUsd: 1234.5,
        apy: 0.05,
        rate: 1.1,
        flags: { deprecated: false, dead: false, stale: false },
      },
    ]);
  });

  it("parses the liveness flags, coercing anything non-true to false", () => {
    const rows = parseDirectoryRows([
      {
        mint: "M",
        symbol: "s",
        flags: { deprecated: true, dead: false, stale: true, isNew: false },
      },
    ]);
    expect(rows[0].flags).toEqual({
      deprecated: true,
      dead: false,
      stale: true,
    });
  });

  it("drops rows missing mint or symbol, or shaped as non-objects", () => {
    const rows = parseDirectoryRows([
      { symbol: "noMint" },
      { mint: "onlyMint" },
      { mint: "", symbol: "emptyMint" },
      null,
      undefined,
      "not-an-object",
      42,
    ]);
    expect(rows).toEqual([]);
  });

  it("defaults missing optional fields instead of throwing", () => {
    const rows = parseDirectoryRows([{ mint: "M", symbol: "s" }]);
    expect(rows).toEqual([
      {
        mint: "M",
        symbol: "s",
        name: "s",
        logoUri: null,
        poolProgram: null,
        tvlUsd: null,
        apy: null,
        rate: null,
        flags: { deprecated: false, dead: false, stale: false },
      },
    ]);
  });

  it("drops a NaN/Infinity number field to null rather than propagating it", () => {
    const rows = parseDirectoryRows([
      {
        mint: "M",
        symbol: "s",
        tvlUsd: Number.NaN,
        apy: Number.POSITIVE_INFINITY,
      },
    ]);
    expect(rows[0].tvlUsd).toBeNull();
    expect(rows[0].apy).toBeNull();
  });

  it("returns [] for a non-array input", () => {
    expect(parseDirectoryRows(undefined)).toEqual([]);
    expect(parseDirectoryRows(null)).toEqual([]);
    expect(parseDirectoryRows({ rows: [] })).toEqual([]);
  });
});
