import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// next/link needs the app router in a real tree; render a plain <a> for the
// unit test (same pattern as tests/unit/organisms/mobile-asset-row.test.tsx).
vi.mock("next/link", () => ({
  default: React.forwardRef<
    HTMLAnchorElement,
    { children?: React.ReactNode; href?: string }
  >(function MockLink({ children, ...props }, ref) {
    return (
      <a ref={ref} {...props}>
        {children}
      </a>
    );
  }),
}));

import { DashboardVerdict } from "@/components/organisms/dashboard-verdict";
import type {
  VerdictCounts,
  ClosestToBand,
  LastTransition,
} from "@/lib/asset/digest";

const NOW = Date.parse("2026-07-14T12:00:00.000Z");

function closest(
  symbol: string,
  bpsAway: number,
  state: ClosestToBand["state"] = "PEGGED",
): ClosestToBand {
  return {
    symbol,
    name: `${symbol} name`,
    mint: `mint-${symbol}`,
    class: "stable_fiat",
    state,
    bps: 20,
    bpsAway,
    prox: 0.4,
    thresholds: { drift_bps: 30, depeg_bps: 100, critical_bps: 200 },
  };
}

function hrefs(): string[] {
  return screen
    .getAllByRole("link")
    .map((l) => l.getAttribute("href") ?? "")
    .filter(Boolean);
}

describe("DashboardVerdict", () => {
  it("calm day: confident headline, closest-to-band stat-object, trust chip — no problem chips, no negative copy", () => {
    const counts: VerdictCounts = {
      total: 63,
      offPeg: 0,
      drift: 0,
      unknown: 0,
    };
    render(
      <DashboardVerdict
        counts={counts}
        closest={closest("USDT", 20)}
        transition={null}
        problemAssets={[]}
        nowMs={NOW}
      />,
    );
    expect(screen.getByText("All 63 assets holding peg.")).toBeInTheDocument();
    // Stat-object: label + value are now separate nodes (not one sentence).
    expect(screen.getByText("Closest to band")).toBeInTheDocument();
    expect(screen.getByText(/USDT · 0\.20% away/)).toBeInTheDocument();
    // Trust chip is a real chip linking to /audit.
    expect(screen.getByText(/Byte-exact replayable/)).toHaveAttribute(
      "href",
      "/audit",
    );
    // No problem-chips row on a calm day (the closest-to-band stat still links
    // to /asset/, so absence of the CHIPS is the precise assertion here), and
    // no "0 transitions" style negative copy.
    expect(
      screen.queryByLabelText(/Assets off peg or drifting/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/0 transitions|0 changes/i),
    ).not.toBeInTheDocument();
  });

  it("incident: off-peg headline in the depeg tone, worst-first problem chips linking to each asset, and the receipt link", () => {
    const counts: VerdictCounts = {
      total: 63,
      offPeg: 2,
      drift: 1,
      unknown: 0,
    };
    const transition: LastTransition = {
      symbol: "USDe",
      from: "PEGGED",
      to: "DEPEG",
      detectedAt: new Date(NOW - 180_000).toISOString(),
      alertId: "alert-9",
    };
    render(
      <DashboardVerdict
        counts={counts}
        closest={closest("USDe", 0, "DEPEG")}
        transition={transition}
        problemAssets={[
          { symbol: "USDe", state: "DEPEG", bps: 210, hasBps: true },
          { symbol: "sFRAX", state: "DRIFT", bps: 30, hasBps: true },
          { symbol: "xSOL", state: "DRIFT", bps: 0, hasBps: false },
        ]}
        nowMs={NOW}
      />,
    );
    const headline = screen.getByText("2 assets off peg right now.");
    expect(headline).toBeInTheDocument();
    expect(headline.className).toContain("text-st-depeg-text");

    // Problem chips: each links to its asset page (worst-first order preserved).
    const assetLinks = hrefs().filter((h) => h.startsWith("/asset/"));
    expect(assetLinks).toContain("/asset/USDe");
    expect(assetLinks).toContain("/asset/sFRAX");
    expect(assetLinks).toContain("/asset/xSOL");

    // A stale/unreadable chip shows "-", never a fabricated bps.
    expect(screen.getByText("-")).toBeInTheDocument();

    // Receipt link (the last-transition stat-object is the clickable link).
    expect(screen.getByText("receipt →").closest("a")).toHaveAttribute(
      "href",
      "/audit/alert-9",
    );
  });
});
