import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// HelpIcon pulls in the glossary context + radix Tooltip; mock it out so these
// tests stay focused on the NAV math + the confidence gating logic.
vi.mock("@/components/atoms/help-icon", () => ({ HelpIcon: () => null }));

import { NavBacking } from "@/components/molecules/nav-backing";
import { PythConfidenceBadge } from "@/components/atoms/pyth-confidence-badge";
import type { AssetCardData } from "@/lib/api/types";

const base = {
  symbol: "jitoSOL",
  name: "Jito Liquid Staking",
  mint: "J1to",
  peg_target: "SOL",
  decimals: 9,
  state: "PEGGED",
  discount: "-0.004",
  market_usd: "165.0",
  updated_at: new Date().toISOString(),
} as unknown as AssetCardData;

describe("NavBacking — proof of reserves", () => {
  it("decomposes intrinsic = sol_per_lst × SOL/USD for an LST", () => {
    render(
      <NavBacking
        asset={{
          ...base,
          class: "lst",
          sol_per_lst: "1.117",
          intrinsic_usd: "164.42",
        }}
      />,
    );
    expect(
      screen.getByText(/Backing · proof of reserves/i),
    ).toBeInTheDocument();
    expect(screen.getByText("1.1170")).toBeInTheDocument(); // SOL / share
    expect(screen.getByText("$164.42")).toBeInTheDocument(); // intrinsic
    // implied SOL/USD = 164.42 / 1.117 = 147.198… → $147.20
    expect(screen.getByText("$147.20")).toBeInTheDocument();
  });

  it("renders nothing for a non-LST", () => {
    const { container } = render(
      <NavBacking
        asset={{
          ...base,
          class: "stable_fiat",
          sol_per_lst: "1.1",
          intrinsic_usd: "1.0",
        }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an LST missing sol_per_lst (additive-safe vs the old API)", () => {
    const { container } = render(
      <NavBacking asset={{ ...base, class: "lst", intrinsic_usd: "164" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PythConfidenceBadge — H1/H9 staleness gating", () => {
  it("shows the bucket when the sample is fresh", () => {
    render(
      <PythConfidenceBadge
        confidence="high"
        updatedAt={new Date().toISOString()}
      />,
    );
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("downgrades a STALE sample to 'No signal' (never serve stale confidence as live)", () => {
    const stale = new Date(Date.now() - 20 * 60_000).toISOString();
    render(<PythConfidenceBadge confidence="high" updatedAt={stale} />);
    expect(screen.getByText("No signal")).toBeInTheDocument();
    expect(screen.queryByText("High")).toBeNull();
  });

  it("treats a missing value as 'No signal' (never upgrade absent → a good bucket)", () => {
    render(
      <PythConfidenceBadge
        confidence={undefined}
        updatedAt={new Date().toISOString()}
      />,
    );
    expect(screen.getByText("No signal")).toBeInTheDocument();
  });
});
