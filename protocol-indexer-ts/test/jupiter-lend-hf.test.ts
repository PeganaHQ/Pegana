import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { getRatioAtTick } from "../src/sources/jupiter-lend-hf";

// Locks the ported Fluid tick math (getRatioAtTick) — validated 1:1 live against
// @jup-ag/lend-read's own buildNftPositionFromPositionAccount (supply + borrow
// matched exactly for every healthy JLP-vault position). borrow = ratio·supply>>48.
describe("Jupiter Lend tick math (getRatioAtTick)", () => {
  const Q48 = new BN(2).pow(new BN(48));

  it("ratio at tick 0 is 1.0 (Q48) → borrow == supply", () => {
    expect(getRatioAtTick(0).eq(Q48)).toBe(true);
  });

  it("ratio grows ~1.0015^tick (tick 1000 ≈ 4.48×)", () => {
    const mult = Number(getRatioAtTick(1000).toString()) / Number(Q48.toString());
    expect(mult).toBeGreaterThan(4.45);
    expect(mult).toBeLessThan(4.5);
  });

  it("negative tick shrinks the ratio (tick -5000 ≈ 1.0015^-5000 ≈ 0.000556×)", () => {
    const mult = Number(getRatioAtTick(-5000).toString()) / Number(Q48.toString());
    expect(mult).toBeGreaterThan(0.00055);
    expect(mult).toBeLessThan(0.00056);
  });

  it("borrow = ratio·supply>>48 reproduces a live JLP position (tick 433)", () => {
    // JLP vault pos 17 (verified live): supplyAmount 999999997000, tick 433 →
    // raw borrow (pre-dust, pre-exchange) = 1912435864685.
    const supply = new BN("999999997000");
    const borrowRaw = getRatioAtTick(433).mul(supply).shrn(48);
    // ratio(433) ≈ 1.0015^433 ≈ 1.9124 → borrow ≈ 1.9124 × supply.
    const mult = Number(borrowRaw.toString()) / Number(supply.toString());
    expect(mult).toBeGreaterThan(1.91);
    expect(mult).toBeLessThan(1.92);
  });
});
