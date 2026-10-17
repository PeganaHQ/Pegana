import { describe, expect, it } from "vitest";
import {
  holderSignedPct,
  spreadSignClass,
  spreadSignVar,
} from "@/lib/api/format";
import { v2SpreadSignClass } from "@/components/organisms/v2/shared";
import { satoriSpreadColor, SPREAD_SIGN_COLOR } from "@/lib/og/shared";

const GREEN = "text-st-pegged";
const RED = "text-st-depeg-text";
const NEUTRAL = "text-text";

/**
 * THE INVARIANT THIS FILE EXISTS FOR.
 *
 * The API's `discount` / `reconcileBps().bps` is premium-NEGATIVE, and display
 * layers negate it. A 2026-07-23 audit found ~11 surfaces printing that sign
 * backwards. Now that color is ALSO derived from the sign, a second copy of
 * that mistake would show a red `+0.30%` or a green `−0.09%` and nobody would
 * notice until a user did.
 *
 * So: for the same raw input, the printed sign and the chosen color must always
 * agree. Not "look right" — agree, mechanically.
 */
describe("sign and color never disagree", () => {
  // Real production readings (raw reconcileBps convention: premium NEGATIVE).
  const RAW_SAMPLES = [
    719, // jitoSOL 2026-08-10: raw positive → holder DISCOUNT
    -92, // hyUSD: raw negative → holder PREMIUM
    1, -1, 5000, -5000, 0.4, -0.4,
  ];

  it.each(RAW_SAMPLES)("raw bps %d", (raw) => {
    const text = holderSignedPct(raw);
    const cls = spreadSignClass(raw);

    if (text.startsWith("+")) {
      expect(cls, `"${text}" printed as a premium must be green`).toBe(GREEN);
    } else if (text.startsWith("−") || text.startsWith("-")) {
      expect(cls, `"${text}" printed as a discount must be red`).toBe(RED);
    } else {
      expect(cls, `"${text}" has no sign, so it must be neutral`).toBe(NEUTRAL);
    }
  });

  it("catches the inversion directly: a raw POSITIVE bps is a holder discount", () => {
    // This is the exact trap. Raw +719 reads as "−0.07%" to a holder, so it is
    // RED. Anyone "simplifying" spreadSignClass to `raw > 0 ? green : red`
    // breaks this line.
    expect(holderSignedPct(719)).toContain("−");
    expect(spreadSignClass(719)).toBe(RED);

    expect(holderSignedPct(-719)).toContain("+");
    expect(spreadSignClass(-719)).toBe(GREEN);
  });
});

describe("spreadSignClass", () => {
  it("treats zero and -0 as neutral, never green or red", () => {
    expect(spreadSignClass(0)).toBe(NEUTRAL);
    expect(spreadSignClass(-0)).toBe(NEUTRAL);
    // holderSignedPct normalises both to a signless string.
    expect(holderSignedPct(0)).not.toContain("+");
    expect(holderSignedPct(0)).not.toContain("−");
  });

  it("is total for absent and non-finite input", () => {
    expect(spreadSignClass(null)).toBe(NEUTRAL);
    expect(spreadSignClass(undefined)).toBe(NEUTRAL);
    expect(spreadSignClass(NaN)).toBe(NEUTRAL);
    expect(spreadSignClass(Infinity)).toBe(NEUTRAL);
  });

  it("spreadSignVar mirrors spreadSignClass with CSS vars", () => {
    expect(spreadSignVar(-1)).toBe("var(--color-st-pegged)");
    expect(spreadSignVar(1)).toBe("var(--color-st-depeg-text)");
    expect(spreadSignVar(0)).toBe("var(--color-text)");
    expect(spreadSignVar(null)).toBe("var(--color-text)");
  });
});

/**
 * The two helpers take OPPOSITE input conventions on purpose: the app passes
 * raw bps, V2's data layer is already holder-signed at rest (toBoardRow and
 * lst/merge.ts both negate). Pin that they still agree on the OUTPUT for the
 * same economic scenario, so a future "unify the contract" refactor cannot
 * silently invert one of them.
 */
describe("v2SpreadSignClass has an inverted input contract, same output", () => {
  it("a premium is green in both, from opposite input signs", () => {
    expect(spreadSignClass(-30)).toBe(GREEN); // raw negative = premium
    expect(v2SpreadSignClass(30)).toBe("text-[var(--v2-peg)]"); // holder positive = premium
  });

  it("a discount is red in both, from opposite input signs", () => {
    expect(spreadSignClass(30)).toBe(RED);
    expect(v2SpreadSignClass(-30)).toBe("text-[var(--v2-depeg)]");
  });

  it("is total for zero and absent", () => {
    expect(v2SpreadSignClass(0)).toBe("text-[var(--v2-text)]");
    expect(v2SpreadSignClass(null)).toBe("text-[var(--v2-text)]");
    expect(v2SpreadSignClass(undefined)).toBe("text-[var(--v2-text)]");
  });
});

/**
 * Satori cannot read CSS custom properties, so the share/OG cards carry hand-
 * maintained hex twins. Before 2026-08-10 they used STATE_COLOR, which has no
 * neutral PEGGED — a PEGGED asset's `−0.09%` rendered GREEN. That contradiction
 * between the app page and the share card is what prompted this whole change.
 */
describe("satoriSpreadColor", () => {
  it("uses the same raw-bps contract as spreadSignClass", () => {
    expect(satoriSpreadColor(719)).toBe(SPREAD_SIGN_COLOR.negative);
    expect(satoriSpreadColor(-719)).toBe(SPREAD_SIGN_COLOR.positive);
    expect(satoriSpreadColor(0)).toBe(SPREAD_SIGN_COLOR.neutral);
    expect(satoriSpreadColor(null)).toBe(SPREAD_SIGN_COLOR.neutral);
  });

  it("its hexes match the class tokens they stand in for", () => {
    // globals.css: --color-st-pegged / --color-st-depeg-text / --color-text.
    expect(SPREAD_SIGN_COLOR.positive).toBe("#5fd3a0");
    expect(SPREAD_SIGN_COLOR.negative).toBe("#e87089");
    expect(SPREAD_SIGN_COLOR.neutral).toBe("#f5f5f6");
  });

  it("a PEGGED asset with a negative spread is NOT green (the original bug)", () => {
    // jitoSOL, PEGGED, raw +719 → holder "−0.07%". State is irrelevant now.
    expect(satoriSpreadColor(719)).not.toBe(SPREAD_SIGN_COLOR.positive);
  });
});
