import { describe, expect, it } from "vitest";
import {
  SAMPLE_BOARD_ROWS,
  bandProximityPct,
  selectBoardRows,
} from "@/components/organisms/v2/shared";
import type { AssetCardData } from "@/lib/api/types";

// Direction-sensitivity + holder-sign correctness pass (2026-07-15). The
// bug this guards: a Pegged LST at a small premium (market ABOVE intrinsic)
// must read CALM everywhere — low band-proximity, no amber "drifting" tint,
// and a `+` holder-signed spread — never "100% / off-scale / depegged" or a
// scary "−" sign.

describe("SAMPLE_BOARD_ROWS — spreadLabel is holder-consistent with market/intrinsic", () => {
  it("every numeric row's sign matches its own market-vs-intrinsic comparison", () => {
    for (const row of SAMPLE_BOARD_ROWS) {
      const market = parseFloat(row.marketLabel);
      const intrinsic = parseFloat(row.intrinsicLabel);
      if (Number.isNaN(market) || Number.isNaN(intrinsic)) continue; // e.g. sHYUSD's "no verified source"
      const expectSign =
        market > intrinsic ? "+" : market < intrinsic ? "−" : "";
      expect(
        row.spreadLabel.startsWith(expectSign) ||
          (expectSign === "" && !/^[+−]/.test(row.spreadLabel)),
        `${row.symbol}: market ${row.marketLabel} vs intrinsic ${row.intrinsicLabel} should sign "${expectSign}", got "${row.spreadLabel}"`,
      ).toBe(true);
    }
  });

  it("USDT (market > intrinsic) is a premium: '+'", () => {
    const usdt = SAMPLE_BOARD_ROWS.find((r) => r.symbol === "USDT")!;
    expect(usdt.spreadLabel).toBe("+0.01%");
  });

  it("jitoSOL (market < intrinsic) is a discount: '−', matching its DRIFT/amber treatment", () => {
    const jito = SAMPLE_BOARD_ROWS.find((r) => r.symbol === "jitoSOL")!;
    expect(jito.spreadLabel).toBe("−0.41%");
    expect(jito.amberTint).toBe(true);
  });

  // `spreadBps` was added on 2026-08-10 to drive the sign COLOUR, and was
  // hand-derived from each row's existing spreadLabel string. Nothing pinned
  // the two together, so a future edit to one could silently leave a row whose
  // label reads "−0.41%" painted green. Pin them.
  it("every row's spreadBps agrees in sign AND magnitude with its spreadLabel", () => {
    for (const row of SAMPLE_BOARD_ROWS) {
      if (row.spreadBps == null) {
        expect(
          /^[+−]/.test(row.spreadLabel),
          `${row.symbol}: spreadBps is null so spreadLabel must carry no sign, got "${row.spreadLabel}"`,
        ).toBe(false);
        continue;
      }
      // BoardRow.spreadBps is holder-signed (positive = premium), matching the
      // printed label — the inverse of the app's raw convention.
      const labelSign = row.spreadLabel.startsWith("+")
        ? 1
        : row.spreadLabel.startsWith("−")
          ? -1
          : 0;
      expect(
        Math.sign(row.spreadBps),
        `${row.symbol}: label "${row.spreadLabel}" vs spreadBps ${row.spreadBps}`,
      ).toBe(labelSign);

      const labelPct = parseFloat(row.spreadLabel.replace(/[+−%]/g, ""));
      expect(
        Math.abs(Math.abs(row.spreadBps) / 100 - labelPct),
        `${row.symbol}: ${row.spreadBps}bps should print as ${labelPct}%`,
      ).toBeLessThan(0.005);
    }
  });
});

describe("bandProximityPct — direction-sensitive carve-out (ADR-0021)", () => {
  it("a premium (bps < 0) on a direction-sensitive class (lst) clamps to the calm PEGGED floor, even overriding a DRIFT-bucket state", () => {
    expect(bandProximityPct("DRIFT", { bps: -105, klass: "lst" })).toBe(8);
  });

  it("a premium on stable_yield is also carved out", () => {
    expect(
      bandProximityPct("DEPEG", { bps: -300, klass: "stable_yield" }),
    ).toBe(8);
  });

  it("a genuine discount (bps > 0) on a direction-sensitive class is NOT carved out — normal state bucket applies", () => {
    expect(bandProximityPct("DRIFT", { bps: 105, klass: "lst" })).toBe(55);
  });

  it("a premium on a symmetric class (stable_fiat) is NOT carved out", () => {
    expect(bandProximityPct("DRIFT", { bps: -105, klass: "stable_fiat" })).toBe(
      55,
    );
  });

  it("omitting opts keeps the plain state-bucketed reading (backward compatible)", () => {
    expect(bandProximityPct("PEGGED")).toBe(8);
    expect(bandProximityPct("DRIFT")).toBe(55);
    expect(bandProximityPct("DEPEG")).toBe(80);
    expect(bandProximityPct("CRITICAL")).toBe(96);
    expect(bandProximityPct(null)).toBeNull();
  });
});

function mkAsset(overrides: Partial<AssetCardData>): AssetCardData {
  return {
    symbol: "mSOL",
    name: "Marinade staked SOL",
    mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    class: "lst",
    peg_target: "SOL",
    decimals: 9,
    state: "DRIFT",
    discount: null,
    intrinsic_usd: "189.00",
    market_usd: "190.99",
    risk_score: null,
    market_cap: null,
    circulating_supply: null,
    liquidity_usd: null,
    volume_24h_usd: null,
    holder_count: null,
    market_context_at: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("selectBoardRows (live path) — a premium LST reads calm end-to-end", () => {
  it("a Pegged-in-spirit LST premium (~+1.05%) gets LOW gaugePct, a '+' holder-signed spread, and no amber tint — even while the committed state still says DRIFT", () => {
    const asset = mkAsset({}); // market 190.99 > intrinsic 189.00 ⇒ premium
    const [row] = selectBoardRows([asset], Date.now(), 1);

    expect(row.spreadLabel.startsWith("+")).toBe(true);
    expect(row.spreadLabel).toBe("+1.05%");
    // LOW proximity — the same calm floor as PEGGED, never 100%/off-scale.
    expect(row.gaugePct).toBe(8);
    // A benign premium must never wear the amber "drifting" tint.
    expect(row.amberTint).toBe(false);
  });

  it("control: a genuine LST discount of the same magnitude (~-1.04%) is NOT carved out", () => {
    const asset = mkAsset({
      intrinsic_usd: "190.99",
      market_usd: "189.00", // market BELOW intrinsic ⇒ a real discount
    });
    const [row] = selectBoardRows([asset], Date.now(), 1);

    // toBoardRow's discount path renders the negative sign via JS's native
    // Number#toFixed (ASCII hyphen-minus), unlike SAMPLE_BOARD_ROWS' hand-
    // authored Unicode minus — assert on sign/magnitude, not the glyph.
    expect(parseFloat(row.spreadLabel)).toBeLessThan(0);
    expect(row.spreadLabel.startsWith("+")).toBe(false);
    expect(row.gaugePct).toBe(55); // DRIFT bucket, uncarved
    expect(row.amberTint).toBe(true);
  });
});
