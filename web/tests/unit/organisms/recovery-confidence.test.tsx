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
import { RecoveryConfidence } from "@/components/organisms/recovery-confidence";
import type { AssetCardData } from "@/lib/api/types";

vi.mock("@/components/atoms/help-icon", () => ({
  HelpIcon: () => <span data-testid="help-icon" />,
}));

const ASSET: AssetCardData = {
  symbol: "sHYUSD",
  name: "Staked Hylo USD",
  mint: "HYUSDmint1111111111111111111111111111111111",
  class: "stable_yield",
  peg_target: "USD",
  decimals: 6,
  state: "UNKNOWN",
  discount: "0.1690",
  intrinsic_usd: "1.2011",
  market_usd: "1.0000",
  risk_score: null,
  market_cap: null,
  circulating_supply: null,
  liquidity_usd: null,
  volume_24h_usd: null,
  holder_count: null,
  market_context_at: null,
  updated_at: new Date().toISOString(),
};

describe("RecoveryConfidence — UNKNOWN gate", () => {
  it("renders nothing (null) when state is UNKNOWN", () => {
    render(
      <RecoveryConfidence
        asset={ASSET}
        history={[]}
        alerts={[]}
        peers={[]}
        state="UNKNOWN"
      />,
    );
    expect(
      screen.getByText("Recovery data unavailable for this state."),
    ).toBeInTheDocument();
  });

  it("does NOT show the editorial grade or 'What we think' heading when UNKNOWN", () => {
    render(
      <RecoveryConfidence
        asset={ASSET}
        history={[]}
        alerts={[]}
        peers={[]}
        state="UNKNOWN"
      />,
    );
    expect(screen.queryByText(/what we think happens next/i)).toBeNull();
    expect(screen.queryByText(/recovery confidence/i)).toBeNull();
    // Grade letters like "D" in the gauge must not appear.
    expect(
      screen.queryByRole("img", { name: /recovery confidence/i }),
    ).toBeNull();
  });

  it("DOES render the full panel when state is PEGGED", () => {
    render(
      <RecoveryConfidence
        asset={{ ...ASSET, state: "PEGGED" }}
        history={[]}
        alerts={[]}
        peers={[]}
        state="PEGGED"
      />,
    );
    // The h2 heading is the primary landmark — target it via the heading role.
    expect(
      screen.getByRole("heading", { name: /recovery confidence/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/what we think happens next/i)).toBeInTheDocument();
    // The rubric breakdown (peg time label) must be present in at least one element.
    expect(screen.getAllByText(/peg time/i).length).toBeGreaterThan(0);
  });

  it("DOES render the full panel when state is DRIFT", () => {
    render(
      <RecoveryConfidence
        asset={{ ...ASSET, state: "DRIFT" }}
        history={[]}
        alerts={[]}
        peers={[]}
        state="DRIFT"
      />,
    );
    expect(
      screen.getByRole("heading", { name: /recovery confidence/i }),
    ).toBeInTheDocument();
  });

  it("renders normally when no state prop passed (backward compat — treated as classified)", () => {
    render(
      <RecoveryConfidence
        asset={{ ...ASSET, state: "PEGGED" }}
        history={[]}
        alerts={[]}
        peers={[]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /recovery confidence/i }),
    ).toBeInTheDocument();
  });
});
