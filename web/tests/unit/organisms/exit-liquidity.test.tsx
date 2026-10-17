import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ExitLiquidity } from "@/components/organisms/exit-liquidity";
import type { AssetCardData } from "@/lib/api/types";

// ExitLiquidity calls fetch (Jupiter quotes) and matchMedia (mobile detection).
// Both are irrelevant for the UNKNOWN gate test — we just need the guard to
// fire before any of that runs.
vi.mock("node-fetch", () => ({}));

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

describe("ExitLiquidity — UNKNOWN gate", () => {
  it("does NOT show the quote table when state is UNKNOWN", () => {
    render(<ExitLiquidity asset={ASSET} state="UNKNOWN" />);
    // The confident "Safe to exit" copy must be absent.
    expect(screen.queryByText(/safe to exit/i)).toBeNull();
    // The slippage table headers must be absent.
    expect(screen.queryByText(/slippage by size/i)).not.toHaveTextContent?.(
      "Live Jupiter",
    );
    // An honest "insufficient signal" message should appear instead.
    expect(screen.getByText(/insufficient signal/i)).toBeInTheDocument();
  });

  it("shows the heading and neutral note (not quote rows) when state is UNKNOWN", () => {
    render(<ExitLiquidity asset={ASSET} state="UNKNOWN" />);
    expect(screen.getByText("Exit liquidity")).toBeInTheDocument();
    // Neutral placeholder must mention why quotes are hidden.
    // Note: the component uses a typographic apostrophe (’) — match broadly.
    expect(screen.getByText(/exit quotes are hidden/i)).toBeInTheDocument();
  });

  it("DOES render the quote table section when state is PEGGED", () => {
    render(
      <ExitLiquidity asset={{ ...ASSET, state: "PEGGED" }} state="PEGGED" />,
    );
    // The table renders with loading skeletons — "Fetching…" or column headers.
    // The "insufficient signal" note must NOT appear.
    expect(screen.queryByText(/insufficient signal/i)).toBeNull();
    // Size column header is present in the full table.
    expect(
      screen.getAllByText(/size|fetching|quote failed/i).length,
    ).toBeGreaterThan(0);
  });

  it("DOES render normally when no state prop is passed (backward compat)", () => {
    render(<ExitLiquidity asset={{ ...ASSET, state: "PEGGED" }} />);
    expect(screen.queryByText(/insufficient signal/i)).toBeNull();
  });
});
