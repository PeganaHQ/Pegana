import { describe, it, expect } from "vitest";
import {
  compareWorstFirst,
  STATE_SEVERITY,
  type LiveOverride,
} from "@/lib/asset/worst-sort";
import type { AssetCardData, PegState } from "@/lib/api/types";

const NOW = Date.parse("2026-06-04T12:00:00.000Z");
const FRESH = new Date(NOW - 30_000).toISOString();
// Beyond STALE_AFTER_MS (15-min server-aligned window).
const STALE = new Date(NOW - 20 * 60_000).toISOString();

// Minimal fixtures. The cases below all differ in state SEVERITY, so the
// proximity tie-break (which needs real thresholds) never fires — keeps the
// assertions deterministic and focused on the H1/H9 freshness gate.
function mk(
  symbol: string,
  state: PegState,
  updated_at: string | null,
): AssetCardData {
  return {
    symbol,
    name: symbol,
    class: "stable_fiat",
    state,
    updated_at,
    discount: null,
    intrinsic_usd: null,
    market_usd: null,
  } as AssetCardData;
}

const order = (arr: AssetCardData[], live: Record<string, LiveOverride> = {}) =>
  [...arr]
    .sort((a, b) => compareWorstFirst(a, b, live, NOW))
    .map((a) => a.symbol);

describe("compareWorstFirst", () => {
  it("orders by state severity, worst first", () => {
    expect(
      order([
        mk("PEG", "PEGGED", FRESH),
        mk("DRI", "DRIFT", FRESH),
        mk("DEP", "DEPEG", FRESH),
        mk("CRI", "CRITICAL", FRESH),
      ]),
    ).toEqual(["CRI", "DEP", "DRI", "PEG"]);
  });

  it("sinks a KNOWN-stale asset to the bottom even if its frozen state is DEPEG (H1/H9)", () => {
    // frozen DEPEG degrades to UNKNOWN (-1) < PEGGED (0) → sorts last, never first.
    expect(
      order([mk("ZOMBIE", "DEPEG", STALE), mk("OK", "PEGGED", FRESH)]),
    ).toEqual(["OK", "ZOMBIE"]);
  });

  it("prefers a fresh live frame's state over the REST snapshot", () => {
    const live: Record<string, LiveOverride> = {
      A: { state: "DEPEG", updated_at: FRESH },
    };
    expect(
      order([mk("A", "PEGGED", FRESH), mk("B", "PEGGED", FRESH)], live),
    ).toEqual(["A", "B"]);
  });

  it("ranks UNKNOWN below PEGGED and BLACK_SWAN above CRITICAL", () => {
    expect(STATE_SEVERITY.UNKNOWN).toBeLessThan(STATE_SEVERITY.PEGGED);
    expect(STATE_SEVERITY.BLACK_SWAN).toBeGreaterThan(STATE_SEVERITY.CRITICAL);
  });
});
