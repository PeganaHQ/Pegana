import { describe, it, expect } from "vitest";
import { collapseFlaps } from "@/lib/asset/markers";
import type { PegState } from "@/lib/api/types";

const seed = (time: number, state: PegState, id: string) => ({
  time,
  state,
  id,
});

describe("collapseFlaps — de-noise rapid flapping transition markers", () => {
  it("collapses a same-area burst into a single most-severe marker", () => {
    // hyUSD-style PEGGED↔DRIFT flap every 60s; 300s gap → one cluster, worst = DRIFT.
    const out = collapseFlaps(
      [
        seed(0, "DRIFT", "a"),
        seed(60, "PEGGED", "b"),
        seed(120, "DRIFT", "c"),
        seed(180, "PEGGED", "d"),
      ],
      300,
    );
    expect(out).toHaveLength(1);
    expect(out[0].state).toBe("DRIFT");
  });

  it("keeps events spaced further apart than the gap", () => {
    const out = collapseFlaps(
      [seed(0, "DRIFT", "a"), seed(1000, "DRIFT", "b")],
      300,
    );
    expect(out).toHaveLength(2);
  });

  it("never hides severity — emits the worst seed of the cluster (its own time/id), not the first", () => {
    const out = collapseFlaps(
      [seed(0, "DRIFT", "a"), seed(60, "DEPEG", "b"), seed(120, "PEGGED", "c")],
      300,
    );
    expect(out).toHaveLength(1);
    expect(out[0].state).toBe("DEPEG");
    expect(out[0].id).toBe("b");
    expect(out[0].time).toBe(60);
  });

  it("ranks BLACK_SWAN > CRITICAL > DEPEG > DRIFT > PEGGED (shared STATE_SEVERITY)", () => {
    expect(
      collapseFlaps([seed(0, "CRITICAL", "a"), seed(60, "DEPEG", "b")], 300)[0]
        .state,
    ).toBe("CRITICAL");
    const swan = collapseFlaps(
      [seed(0, "CRITICAL", "a"), seed(60, "BLACK_SWAN", "b")],
      300,
    );
    expect(swan).toHaveLength(1);
    expect(swan[0].state).toBe("BLACK_SWAN"); // never hidden, even behind CRITICAL
  });

  it("returns the input unchanged for 0 or 1 markers", () => {
    expect(collapseFlaps([], 300)).toEqual([]);
    expect(collapseFlaps([seed(0, "DRIFT", "a")], 300)).toHaveLength(1);
  });

  it("chains a long continuous flap into one cluster (each within the gap of the previous)", () => {
    const seeds = Array.from({ length: 20 }, (_, i) =>
      seed(i * 120, i % 2 ? "PEGGED" : "DRIFT", `m${i}`),
    );
    expect(collapseFlaps(seeds, 300)).toHaveLength(1); // 20 flaps → 1 marker
  });
});
