import { describe, it, expect } from "vitest";
import { computeHfBands, type HfEntry } from "../src/core/hf-bands";

const mk = (hf: number, coll: number): HfEntry => ({ hf, collateralUsd: coll, debtUsd: coll * 0.5, liquidationLtv: 0.7 });
const TS = "2026-07-24T00:00:00Z";

describe("computeHfBands — ADR-0036 privacy enforcement", () => {
  it("keeps a well-populated, non-dominated band with a k-floored bucket", () => {
    // 6 healthy obligations, collateral spread evenly (no dominance).
    const rows = computeHfBands("jitoSOL", "kamino", Array.from({ length: 6 }, () => mk(1.5, 100)), TS, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].hf_band).toBe(">1.25");
    expect(rows[0].position_bucket).toBe("5-20"); // range, never "6"
    expect(rows[0].collateral_usd).toBe("600");
  });

  it("DROPS a band with fewer than k=5 obligations (inv.7 k-floor)", () => {
    const rows = computeHfBands("mSOL", "kamino", Array.from({ length: 4 }, () => mk(1.02, 100)), TS, 1);
    expect(rows).toHaveLength(0);
  });

  it("SUPPRESSES a band where one obligation dominates >45% of collateral (l-diversity)", () => {
    // 6 obligations but one whale holds ~83% of the band collateral.
    const entries = [mk(1.02, 1000), ...Array.from({ length: 5 }, () => mk(1.02, 40))];
    const rows = computeHfBands("bonkSOL", "kamino", entries, TS, 1);
    expect(rows).toHaveLength(0);
  });
});
