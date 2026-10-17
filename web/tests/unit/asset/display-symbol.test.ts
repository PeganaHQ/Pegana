import { describe, it, expect } from "vitest";
import { displaySymbol, resolveAliasSymbol } from "@/lib/asset/display-symbol";

describe("displaySymbol", () => {
  it("maps sHYUSD to the eHYUSD display alias", () => {
    expect(displaySymbol("sHYUSD")).toBe("eHYUSD");
  });

  it("returns unrelated symbols unchanged (identity)", () => {
    expect(displaySymbol("jitoSOL")).toBe("jitoSOL");
  });

  it("does not throw on an empty string", () => {
    expect(displaySymbol("")).toBe("");
  });
});

describe("resolveAliasSymbol", () => {
  it("resolves the display alias back to the canonical DB symbol", () => {
    expect(resolveAliasSymbol("eHYUSD")).toBe("sHYUSD");
  });

  it("is case-insensitive (lowercase input)", () => {
    expect(resolveAliasSymbol("ehyusd")).toBe("sHYUSD");
  });

  it("is case-insensitive (uppercase input)", () => {
    expect(resolveAliasSymbol("EHYUSD")).toBe("sHYUSD");
  });

  it("passes the canonical symbol through unchanged", () => {
    expect(resolveAliasSymbol("sHYUSD")).toBe("sHYUSD");
  });

  it("returns unrelated symbols unchanged (identity)", () => {
    expect(resolveAliasSymbol("jitoSOL")).toBe("jitoSOL");
  });

  it("round-trips with displaySymbol", () => {
    expect(resolveAliasSymbol(displaySymbol("sHYUSD"))).toBe("sHYUSD");
  });
});
