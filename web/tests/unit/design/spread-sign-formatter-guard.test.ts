import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

/**
 * One formatter owns the spread sign. Nothing else may build one.
 *
 * `lib/api/format.ts` exports `holderSignedPct` / `formatGap`, which own three
 * decisions at once: which glyph the sign uses (U+2212 MINUS, never an ASCII
 * hyphen), how many decimals a given magnitude gets, and — since 2026-08-10 —
 * the sign that `spreadSignClass` turns into the number's colour.
 *
 * `spread-tape.tsx` had quietly kept its own:
 *
 *     const sign = bps > 0 ? "-" : bps < 0 ? "+" : "";
 *     return `${sign}${(Math.abs(bps) / 100).toFixed(2)}%`;
 *
 * It printed an ASCII "-0.09%" three rows above the table's typographic
 * "−0.09%" — the same asset, the same number, two different glyphs on one
 * screen — and pinned the precision at 2 decimals. Found by dumping character
 * codes off the deployed dashboard: 10 numbers were U+002D and 19 were U+2212.
 *
 * A local copy is also the exact shape of the sign-inversion bug the 2026-07-23
 * audit found on ~11 surfaces, so this guard bans the shape, not just the glyph.
 */

const ROOTS = ["app", "components"] as const;
const EXTS = new Set([".tsx", ".ts"]);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walk(full, acc);
    } else if (EXTS.has(extname(full))) {
      acc.push(full);
    }
  }
  return acc;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const files: string[] = [];
for (const root of ROOTS) {
  try {
    walk(root, files);
  } catch {
    // root absent in some checkouts — nothing to scan
  }
}

/**
 * A ternary whose two branches ARE the sign pair, with the negative side
 * spelled as an ASCII hyphen: `bps > 0 ? "-" : "+"` and the mirrored ordering.
 *
 * Deliberately narrow. A broad "any local sign ternary" scan flags ~10 honest
 * sites — `x == null ? "-" : …` placeholders, and the standalone embed/badge
 * routes that duplicate a formatter on purpose to stay dependency-free — so it
 * would need a ten-file allowlist and would rot into noise. Requiring BOTH
 * branches to be signs separates a sign from a placeholder with no allowlist at
 * all, and this exact shape is what shipped on /heatmap.
 */
const ASCII_SIGN_TERNARY = /\?\s*"-"\s*:\s*"\+"|\?\s*"\+"\s*:\s*"-"/g;

describe("the spread sign is never an ASCII hyphen", () => {
  it("no ternary picks between an ASCII hyphen and a plus", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (ASCII_SIGN_TERNARY.test(src)) offenders.push(file);
      ASCII_SIGN_TERNARY.lastIndex = 0;
    }
    expect(
      offenders,
      `A signed spread uses U+2212 MINUS, not "-". Prefer holderSignedPct(), ` +
        `which also carries the magnitude-adaptive precision:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no source pairs an ASCII hyphen with a percent literal", () => {
    // Catches `"-" + pct` and `` `-${x}%` `` without flagging arithmetic.
    const ASCII_SIGNED_PCT = /["`]-\$?\{?[^"`]*%["`]/g;
    const offenders: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (ASCII_SIGNED_PCT.test(src)) offenders.push(file);
      ASCII_SIGNED_PCT.lastIndex = 0;
    }
    expect(
      offenders,
      `Signed percentages use U+2212 MINUS, not an ASCII hyphen:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("the canonical formatter emits the canonical glyph", () => {
  it("holderSignedPct and formatGap both use U+2212, never U+002D", async () => {
    const { holderSignedPct, formatGap } = await import("@/lib/api/format");
    // ⚠️ The two take OPPOSITE inputs and this is deliberate, not a bug:
    // holderSignedPct takes the RAW premium-negative bps and negates
    // internally; formatGap takes an ALREADY holder-signed value, which is why
    // call sites read `formatGap(-bps)`. Feeding raw 719 to formatGap yields
    // "+7.19%" — correct for its contract, and the exact confusion that makes
    // a hand-rolled local formatter so easy to get backwards.
    for (const out of [holderSignedPct(719), formatGap(-719)]) {
      expect(out).toContain("−");
      expect(out).not.toContain("-");
    }
    expect(holderSignedPct(-719)).toContain("+");
    expect(formatGap(719)).toContain("+");
  });
});
