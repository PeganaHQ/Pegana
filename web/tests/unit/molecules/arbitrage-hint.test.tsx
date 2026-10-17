import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ArbitrageHint } from "@/components/molecules/arbitrage-hint";

// A props set that would normally render the hint (>50 bps gap, liquid asset).
const VISIBLE_PROPS = {
  symbol: "sHYUSD",
  intrinsicUsd: "1.2011",
  marketUsd: "1.0000",
  discountBps: 1000,
};

describe("ArbitrageHint — UNKNOWN gate", () => {
  it("does NOT render the arb hint when state is UNKNOWN", () => {
    const { container } = render(
      <ArbitrageHint {...VISIBLE_PROPS} state="UNKNOWN" />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText(/arb hint/i)).toBeNull();
    expect(screen.queryByText(/captures the gap/i)).toBeNull();
  });

  it("DOES render the arb hint when state is PEGGED (widget not suppressed for classified assets)", () => {
    render(<ArbitrageHint {...VISIBLE_PROPS} state="PEGGED" />);
    expect(
      screen.getByRole("note", { name: /arbitrage hint/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/arb hint/i)).toBeInTheDocument();
  });

  it("DOES render the arb hint when state is DRIFT", () => {
    render(<ArbitrageHint {...VISIBLE_PROPS} state="DRIFT" />);
    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  it("DOES render the arb hint when state is DEPEG", () => {
    render(<ArbitrageHint {...VISIBLE_PROPS} state="DEPEG" />);
    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  it("still applies the existing <50 bps guard regardless of state", () => {
    // 30 bps is below the threshold, so it renders null even for PEGGED.
    const { container } = render(
      <ArbitrageHint {...VISIBLE_PROPS} discountBps={30} state="PEGGED" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders null when no state prop is passed and bps is below threshold", () => {
    const { container } = render(
      <ArbitrageHint {...VISIBLE_PROPS} discountBps={30} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
