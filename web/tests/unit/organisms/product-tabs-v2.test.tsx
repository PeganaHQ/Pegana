import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductTabsV2 } from "@/components/organisms/v2/product-tabs-v2";
import type { AssetCardData } from "@/lib/api/types";

// Residual holder-sign fix (2026-07-15): the jitoSOL demo card in the
// "asset detail" pane was rendering reconcileBps's RAW sign (positive =
// discount) as-is, so a real DISCOUNT (market below NAV) showed a scary "+"
// and a benign PREMIUM would have shown a "-". Holder convention everywhere
// else (merge.ts /lst, shared.tsx toBoardRow, AssetHeroV2): `+` = premium
// (market ABOVE intrinsic), `-`/`−` = discount (below).

let mockJito: AssetCardData | null = null;

vi.mock("@/lib/hooks/use-asset", () => ({
  useAsset: () => ({ data: mockJito }),
}));

vi.mock("@/lib/motion/use-reduced-motion", () => ({
  useAppReducedMotion: () => true,
}));

vi.mock("@/lib/motion/use-reveal-v2", () => ({
  useRevealV2: () => ({ ref: { current: null }, style: {}, inView: true }),
}));

function mkJito(overrides: Partial<AssetCardData>): AssetCardData {
  return {
    symbol: "jitoSOL",
    name: "Jito staked SOL",
    mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    class: "lst",
    peg_target: "SOL",
    decimals: 9,
    state: "DRIFT",
    discount: null,
    intrinsic_usd: "177.15",
    market_usd: "176.42",
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

describe("ProductTabsV2 — jitoSOL spread is holder-signed", () => {
  // reconcileBps returns positive bps for a real discount here (market <
  // intrinsic), and the display negates it — JS's native Number#toFixed
  // renders the negative sign as an ASCII hyphen-minus, unlike the
  // hand-authored Unicode minus in the "no live data" sample fallback below.
  // Assert on sign/magnitude via the live path, glyph only via the fallback.
  it("a genuine discount (market 176.42 < intrinsic 177.15) renders '-0.41%', not '+'", () => {
    mockJito = mkJito({});
    render(<ProductTabsV2 />);

    expect(screen.getByText("-0.41%")).toBeInTheDocument();
    expect(screen.queryByText("+0.41%")).toBeNull();
  });

  it("a premium (market ABOVE intrinsic) renders '+', never a scary '−'", () => {
    mockJito = mkJito({
      intrinsic_usd: "177.15",
      market_usd: "177.87", // market above intrinsic ⇒ a premium
    });
    render(<ProductTabsV2 />);

    const spread = screen.getByText(/^\+0\.\d{2}%$/);
    expect(spread).toBeInTheDocument();
  });

  it("no live data falls back to the artifact's sample, which is itself holder-signed ('−0.41%')", () => {
    mockJito = null;
    render(<ProductTabsV2 />);

    expect(screen.getByText("−0.41%")).toBeInTheDocument();
  });

  it("a benign jitoSOL premium is carved out of the band-proximity gauge (direction-sensitive, ADR-0021) — reads the calm 8%, not a DRIFT-bucket 55%", () => {
    mockJito = mkJito({
      state: "DRIFT", // committed state briefly still says DRIFT
      intrinsic_usd: "177.15",
      market_usd: "177.87", // but the market is ABOVE intrinsic ⇒ premium ⇒ benign
    });
    const { container } = render(<ProductTabsV2 />);

    // bandLabel is inline text (no dedicated wrapping element), so assert on
    // the containing paragraph's full text content rather than getByText.
    expect(container.textContent).toContain("8% of the way to its depeg band");
    expect(container.textContent).not.toContain(
      "55% of the way to its depeg band",
    );
  });

  it("a genuine jitoSOL discount is NOT carved out — the DRIFT-bucket 55% still applies", () => {
    mockJito = mkJito({}); // market 176.42 < intrinsic 177.15 ⇒ a real discount, state DRIFT
    const { container } = render(<ProductTabsV2 />);

    expect(container.textContent).toContain("55% of the way to its depeg band");
    expect(container.textContent).not.toContain(
      "8% of the way to its depeg band",
    );
  });
});
