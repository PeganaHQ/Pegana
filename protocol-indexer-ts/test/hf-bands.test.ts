import { describe, expect, it } from "vitest";
import { computeHfBands, type HfEntry } from "../src/core/hf-bands";
import { num, parseOrNaN } from "../src/core/loop-util";

const e = (over: Partial<HfEntry> = {}): HfEntry => ({
  hf: 1.5, collateralUsd: 100, debtUsd: 50, liquidationLtv: 0.8, ...over,
});
const many = (n: number, over: Partial<HfEntry> = {}) => Array.from({ length: n }, () => e(over));
const run = (entries: HfEntry[]) => computeHfBands("jitoSOL", "kamino", entries, "2026-10-24T00:00:00Z", 1);

describe("computeHfBands input validation", () => {
  it("emits a band for 5 valid entries", () => {
    expect(run(many(5))).toHaveLength(1);
  });

  it.each([
    ["NaN hf", { hf: NaN }],
    ["Infinity hf", { hf: Infinity }],
    ["negative hf", { hf: -1 }],
    ["NaN collateral", { collateralUsd: NaN }],
    ["negative debt", { debtUsd: -5 }],
    ["Infinity liquidationLtv", { liquidationLtv: Infinity }],
  ])("drops an entry with %s (never lands in the >1.25 band)", (_n, bad) => {
    // 4 valid + 1 invalid: if the invalid one were counted the band would reach the k-floor.
    expect(run([...many(4), e(bad)])).toHaveLength(0);
  });

  it("a zero-collateral entry still counts toward the k-floor", () => {
    const rows = run([...many(4), e({ collateralUsd: 0 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.position_bucket).toBe("5-20");
  });
});

describe("num", () => {
  it("keeps '0' at 0 and sanitises bad input to 0", () => {
    expect(num("0")).toBe(0);
    expect(num("-3")).toBe(0);
    expect(num("abc")).toBe(0);
    expect(num(Infinity)).toBe(0);
    expect(num("2.5")).toBe(2.5);
  });
});

describe("parseOrNaN", () => {
  it.each([["0", 0], ["0.8", 0.8], [" 1.5 ", 1.5], ["1e3", 1000], [".5", 0.5], ["-2", -2], [7, 7], ["1e-7", 1e-7], ["5.", 5], ["+3", 3]])(
    "reads %j as %d", (input, out) => expect(parseOrNaN(input)).toBe(out),
  );
  it.each(["", " ", "\n", "abc", "1e3x", "0x10", "Infinity", Infinity, -Infinity, [], [1], {}, null, undefined].map((v) => [v]))(
    "reads %j as NaN", (input) => expect(parseOrNaN(input)).toBeNaN(),
  );
  it("reads a Decimal-like object by its string form", () => {
    expect(parseOrNaN({ toString: () => "0.25" })).toBe(0.25);
  });
});
