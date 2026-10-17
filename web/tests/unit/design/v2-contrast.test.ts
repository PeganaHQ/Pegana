import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * WCAG contrast guard for the V2 token palette.
 *
 * `--v2-dim` must clear AA against every V2 surface because it carries normal
 * text throughout marketing and audit pages. The literal #70707a from the
 * original DESIGN.md measured only 4.04:1 on the page background and less on
 * raised panels. The token was first bumped to #a3a3ad (AA-safe, but identical
 * to --v2-muted, collapsing the 3-level text hierarchy to 2). It now uses
 * #80808a, the closest value to #70707a that still clears AA on every surface
 * (4.58:1 on --v2-panel2, the worst case), preserving a visible separation
 * between dim, muted (#a3a3ad), and body (#b4b4bc).
 */

const V2_CSS = readFileSync(
  join(process.cwd(), "app", "(marketing)", "v2.css"),
  "utf8",
);

function token(name: string): string {
  const m = V2_CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!m) throw new Error(`token --${name} not found in v2.css`);
  return m[1];
}

/** sRGB channel → linear, per WCAG 2.x relative-luminance definition. */
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["v2-bg", "v2-panel", "v2-panel2"] as const;

describe("V2 palette contrast", () => {
  it("--v2-muted clears AA on every V2 surface (it carries the data text)", () => {
    for (const surface of SURFACES) {
      const r = ratio(token("v2-muted"), token(surface));
      expect(
        r,
        `--v2-muted on --${surface} is ${r.toFixed(2)}:1, needs >= 4.5`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("--v2-body and --v2-text clear AA on every V2 surface", () => {
    for (const name of ["v2-body", "v2-text"]) {
      for (const surface of SURFACES) {
        expect(
          ratio(token(name), token(surface)),
          `--${name} on --${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("--v2-dim clears AA on every V2 surface", () => {
    for (const surface of SURFACES) {
      const r = ratio(token("v2-dim"), token(surface));
      expect(
        r,
        `--v2-dim on --${surface} is ${r.toFixed(2)}:1, needs >= 4.5`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("onboarding contrast", () => {
  it("does not dim future step text with opacity", () => {
    const src = readFileSync(
      join(process.cwd(), "components/organisms/onboarding-modal.tsx"),
      "utf8",
    );
    expect(src).not.toContain("opacity-25");
  });
});

describe("data-carrying surfaces stay off the failing token", () => {
  const GUARDED = [
    // The hash-mismatch screen. Highest stakes on the site.
    "components/organisms/receipt-verifier.tsx",
    // Receipt field values.
    "app/(marketing)/audit/[id]/page.tsx",
    "components/organisms/v2/inner/receipt-object-v2.tsx",
    // Ranked/tabular data.
    "components/organisms/lst/lst-directory-table-v2.tsx",
    "app/(marketing)/status/calibration/page.tsx",
    "components/organisms/assets-canon.tsx",
    "app/backtest/2025-10-10-usde-depeg/page.tsx",
    // Added 2026-07-31 after a post-deploy sweep found the SAME class of miss a
    // THIRD time: a `<ListRowsV2>` table's column headers, a per-source role
    // inside a data table, a live "N alerts fired in the last 24 hours" datum,
    // and embed form labels — all still on the failing token in files nobody
    // had added to this list. The guard is only as good as its coverage, so
    // any file rendering DATA text belongs here at the moment it is written.
    "app/(marketing)/whats-new/whats-new-client.tsx",
    "app/(marketing)/status/page.tsx",
    "app/(marketing)/embed/embed-client.tsx",
  ];

  it.each(GUARDED)("%s uses no --v2-dim text", (file) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    expect(src).not.toContain("text-[var(--v2-dim)]");
  });

  /**
   * `hero-v2.tsx` needs a narrower guard than the files above: it legitimately
   * keeps `--v2-dim` on genuinely decorative text (the hero eyebrow, the three
   * inert filter chips), while its live-board internals carry real data.
   *
   * This file was NAMED as fixed in the original commit message and in the doc
   * comment above, and was not actually touched — the swap ran over a 7-file
   * list that never included it. The single most-viewed data text on the site
   * (the board's column headers) sat at 4.43:1 while a test comment claimed
   * otherwise. Guarding the specific strings, not the whole file, so the
   * decorative uses stay allowed and the data uses cannot silently revert.
   */
  const HERO_DATA_STRINGS = [
    // <thead> column headers: Asset / State / Market / Intrinsic / Spread / …
    "uppercase tracking-[0.09em] text-[var(--v2-dim)]",
    // per-row asset class label, band-proximity %, and the no-data markers
    "font-mono text-[10.5px] text-[var(--v2-dim)]",
    "text-right font-mono text-[10.5px] text-[var(--v2-dim)]",
  ];

  it.each(HERO_DATA_STRINGS)(
    "hero-v2 live board keeps data text off --v2-dim (%s)",
    (needle) => {
      const src = readFileSync(
        join(process.cwd(), "components/organisms/v2/hero-v2.tsx"),
        "utf8",
      );
      expect(src).not.toContain(needle);
    },
  );
});
