import React from "react";
import { render as baseRender, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

// The migrated components use the shadcn Tooltip, which requires a
// TooltipProvider ancestor (mounted app-wide in app/layout.tsx). Provide one
// for isolated unit renders.
function render(
  ui: Parameters<typeof baseRender>[0],
  options?: Parameters<typeof baseRender>[1],
) {
  return baseRender(ui, { wrapper: TooltipProvider, ...options });
}
import { describe, it, expect, vi } from "vitest";
import type { AssetCardData } from "@/lib/api/types";

// HelpIcon (via PythConfidenceBadge) pulls in the glossary context + radix
// Tooltip; mock it so the rail renders without a GlossaryProvider wrapper.
vi.mock("@/components/atoms/help-icon", () => ({ HelpIcon: () => null }));

// next/link needs the app router in a real tree; render a plain <a> for the unit test.
vi.mock("next/link", () => ({
  default: React.forwardRef<HTMLAnchorElement, { children?: React.ReactNode }>(
    function MockLink({ children, ...props }, ref) {
      return (
        <a ref={ref} {...props}>
          {children}
        </a>
      );
    },
  ),
}));

import { AssetRail } from "@/components/organisms/asset-rail";

function mk(extra: Partial<AssetCardData> = {}): AssetCardData {
  return {
    symbol: "USDC",
    name: "USD Coin",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    class: "stable_fiat",
    peg_target: "USD",
    decimals: 6,
    state: "PEGGED",
    discount: "0.004",
    intrinsic_usd: "1.00",
    market_usd: "0.996",
    updated_at: new Date().toISOString(),
    ...extra,
  } as AssetCardData;
}

describe("AssetRail — proximity-to-depeg gauge", () => {
  it("renders the BandGauge proximity signal (on-thesis, absent from the hero)", () => {
    // USDC depeg = 50 bps; −40 bps → 80% of the way to depeg. The gauge's
    // accessible name is the only place that proximity reading lives on touch.
    render(
      <AssetRail asset={mk()} bps={-40} state="PEGGED" history={undefined} />,
    );
    const gauge = screen.getByRole("img", { name: /depeg line/i });
    expect(gauge).toBeInTheDocument();
  });

  it("labels the proximity block so the gauge is not a bare bar", () => {
    render(
      <AssetRail asset={mk()} bps={-40} state="PEGGED" history={undefined} />,
    );
    expect(screen.getByText(/proximity to depeg/i)).toBeInTheDocument();
  });
});
