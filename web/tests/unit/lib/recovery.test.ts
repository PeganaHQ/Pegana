import { describe, it, expect } from "vitest";
import { computeRecoveryConfidence } from "@/lib/asset/recovery";
import type { AssetCardData, AlertRow, HistoryPoint } from "@/lib/api/types";

const asset = { symbol: "USDC", class: "stable_fiat" } as AssetCardData;

// History where the asset was PEGGED the whole window.
const peggedHistory: HistoryPoint[] = Array.from({ length: 20 }, (_, i) => ({
  ts: new Date(Date.UTC(2026, 5, 2, 0, i)).toISOString(),
  discount: "-0.0005",
  state: "PEGGED",
})) as unknown as HistoryPoint[];

function alert(detected_at: string, to_state: string): AlertRow {
  return {
    asset: "USDC",
    from_state: "PEGGED",
    to_state,
    detected_at,
  } as unknown as AlertRow;
}

describe("computeRecoveryConfidence — recovery rubric", () => {
  it("flags calibrating when there is no alert signal at all", () => {
    const c = computeRecoveryConfidence(asset, peggedHistory, [], undefined);
    expect(c.calibrating).toBe(true);
  });

  it("does NOT bank full flips credit off an empty alert stream (absence ≠ confirmation)", () => {
    // The bug: flips===0 awarded the full 25. An empty/missing alert stream is
    // MISSING data, not a confirmed-stable asset — it must score a neutral value.
    const c = computeRecoveryConfidence(asset, peggedHistory, [], undefined);
    expect(c.breakdown.flipsCredit).toBe(15); // neutral, not 25
  });

  it("awards graduated flips credit when real alert data is present", () => {
    const alerts: AlertRow[] = [
      alert("2026-06-02T05:00:00Z", "DRIFT"),
      alert("2026-06-02T04:00:00Z", "PEGGED"),
      alert("2026-06-02T03:00:00Z", "DRIFT"),
      alert("2026-06-02T02:00:00Z", "PEGGED"),
      alert("2026-06-02T01:00:00Z", "DRIFT"),
    ]; // 5 flips → the 4–10 bucket → 5 credit
    const c = computeRecoveryConfidence(
      asset,
      peggedHistory,
      alerts,
      undefined,
    );
    expect(c.calibrating).toBe(false);
    expect(c.breakdown.flipsCredit).toBe(5);
  });

  it("exposes a breakdown that sums to the total score", () => {
    const c = computeRecoveryConfidence(asset, peggedHistory, [], undefined);
    const { pegCredit, flipsCredit, peerCredit } = c.breakdown;
    expect(pegCredit + flipsCredit + peerCredit).toBe(c.score);
  });

  it("still grades a calibrating asset lower than the old +25 bug would have", () => {
    const c = computeRecoveryConfidence(asset, peggedHistory, [], undefined);
    // peg ~100% → 50, flips neutral → 15, peers unknown → 15  ⇒ 80 (grade B)
    expect(c.score).toBe(80);
    expect(c.grade).toBe("B");
  });

  it("does NOT flag stressed and keeps the historical grade when state is benign", () => {
    const benign = {
      symbol: "USDC",
      class: "stable_fiat",
      state: "PEGGED",
    } as AssetCardData;
    const c = computeRecoveryConfidence(benign, peggedHistory, [], undefined);
    expect(c.stressed).toBe(false);
    expect(c.grade).toBe("B"); // unchanged: score 80
  });

  it.each(["DEPEG", "CRITICAL", "BLACK_SWAN"] as const)(
    "caps the grade to C and flags stressed when the LIVE state is %s (H1/H9: confirmed stress ≠ clean verdict)",
    (state) => {
      // Historical window is 100% pegged → score 80 → would grade B. The live
      // off-peg state must dominate: grade capped to C, stressed flag set.
      const stressedAsset = {
        symbol: "USDC",
        class: "stable_fiat",
        state,
      } as AssetCardData;
      const c = computeRecoveryConfidence(
        stressedAsset,
        peggedHistory,
        [],
        undefined,
      );
      expect(c.score).toBe(80); // raw rubric untouched — only the surfaced grade is capped
      expect(c.stressed).toBe(true);
      expect(c.grade).toBe("C");
    },
  );

  it("never UPGRADES a worse grade when stressed (cap is a ceiling, not a floor)", () => {
    // A D-grade asset that is also in DEPEG must stay D, not be lifted to C.
    const dHistory: HistoryPoint[] = Array.from({ length: 20 }, (_, i) => ({
      ts: new Date(Date.UTC(2026, 5, 2, 0, i)).toISOString(),
      discount: "-0.0005",
      state: "DEPEG",
    })) as unknown as HistoryPoint[];
    const dAsset = {
      symbol: "USDC",
      class: "stable_fiat",
      state: "DEPEG",
    } as AssetCardData;
    // peg 0% → 0, flips neutral → 15, peers unknown → 15 ⇒ 30 (grade D)
    const c = computeRecoveryConfidence(dAsset, dHistory, [], undefined);
    expect(c.grade).toBe("D");
    expect(c.stressed).toBe(true);
  });

  it("treats a null/UNKNOWN live state as not-stressed (no false confirmation either way)", () => {
    const unknownAsset = {
      symbol: "USDC",
      class: "stable_fiat",
      state: null,
    } as AssetCardData;
    const c = computeRecoveryConfidence(
      unknownAsset,
      peggedHistory,
      [],
      undefined,
    );
    expect(c.stressed).toBe(false);
  });
});
