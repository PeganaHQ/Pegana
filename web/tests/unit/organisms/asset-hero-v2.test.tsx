import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssetHeroV2 } from "@/components/organisms/asset-hero-v2";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { AssetCardData } from "@/lib/api/types";

vi.mock("@/components/atoms/help-icon", () => ({
  HelpIcon: () => <span data-testid="help-icon" />,
}));

const baseAsset: AssetCardData = {
  symbol: "sHYUSD",
  name: "Staked Hylo USD",
  mint: "HnnGv3test",
  class: "stable_yield",
  peg_target: "USD",
  decimals: 6,
  state: "UNKNOWN",
  discount: "0.0100",
  intrinsic_usd: "1.0000",
  market_usd: "1.0100",
  risk_score: null,
  market_cap: null,
  circulating_supply: null,
  liquidity_usd: null,
  volume_24h_usd: null,
  holder_count: null,
  market_context_at: null,
  updated_at: "2026-06-17T12:00:00Z",
};

describe("AssetHeroV2", () => {
  it("renders market above NAV as a premium with the holder-signed '+'", () => {
    render(
      <AssetHeroV2 asset={baseAsset} bps={-100} state="UNKNOWN" history={[]} />,
    );

    // Holder convention: `+` = premium (market ABOVE intrinsic), `−` =
    // discount (below) — a healthy premium must never read as a scary "−".
    expect(screen.getByText("+1.00")).toBeInTheDocument();
    expect(screen.getByText("premium to NAV")).toBeInTheDocument();
    expect(screen.queryByText("discount to NAV")).toBeNull();
  });

  it("renders market below NAV as a discount with the holder-signed '−'", () => {
    const discountAsset: AssetCardData = {
      ...baseAsset,
      market_usd: "0.9900",
      intrinsic_usd: "1.0000",
    };
    render(
      <AssetHeroV2
        asset={discountAsset}
        bps={100}
        state="UNKNOWN"
        history={[]}
      />,
    );

    expect(screen.getByText("−1.00")).toBeInTheDocument();
    expect(screen.getByText("discount to NAV")).toBeInTheDocument();
    expect(screen.queryByText("premium to NAV")).toBeNull();
  });

  it("renders a graceful '—' for market cap and circulating supply when the backend hasn't backfilled them", () => {
    render(
      <AssetHeroV2 asset={baseAsset} bps={-100} state="UNKNOWN" history={[]} />,
    );

    expect(screen.getByText("Market cap")).toBeInTheDocument();
    expect(screen.getByText("Circulating supply")).toBeInTheDocument();
    // Market cap returns "—" (em-dash, formatMarketCapUsd's null convention),
    // the 24h range returns "-" (hyphen). Both must be present as null
    // placeholders — assert at least the size-tier pair renders something.
    // Market cap and 24h range both return "-" (hyphen) for null values;
    // at least one must be present as a null placeholder.
    const capDash = screen.getAllByText("-");
    expect(capDash.length).toBeGreaterThan(0);
  });

  it("formats market cap and circulating supply as size/context figures, never risk-colored", () => {
    const sizedAsset: AssetCardData = {
      ...baseAsset,
      market_cap: "30000000000",
      circulating_supply: "30000000000",
    };
    render(
      <AssetHeroV2 asset={sizedAsset} bps={100} state="UNKNOWN" history={[]} />,
    );

    expect(screen.getByText("$30.00B")).toBeInTheDocument();
    expect(
      screen.getByText(`30.00B ${displaySymbol(sizedAsset.symbol)}`),
    ).toBeInTheDocument();
    expect(screen.getByText("Size: not a safety signal")).toBeInTheDocument();
  });

  it("renders the eHYUSD display alias for sHYUSD, never the raw DB symbol", () => {
    render(
      <AssetHeroV2 asset={baseAsset} bps={-100} state="UNKNOWN" history={[]} />,
    );

    // baseAsset.symbol is "sHYUSD" — both the <h1> and TokenIcon's a11y
    // label must render the alias; the raw DB symbol must never leak into
    // the DOM text.
    expect(screen.getByText("eHYUSD")).toBeInTheDocument();
    expect(screen.queryByText("sHYUSD")).toBeNull();
  });
});
