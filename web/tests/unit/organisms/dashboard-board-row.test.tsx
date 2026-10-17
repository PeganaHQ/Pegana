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

import { DashboardBoardRow } from "@/components/organisms/dashboard-board-row";

function mk(extra: Partial<AssetCardData> = {}): AssetCardData {
  return {
    symbol: "USDX",
    name: "Test USD",
    mint: "mint-usdx",
    class: "stable_fiat",
    state: "PEGGED",
    updated_at: new Date().toISOString(),
    discount: "0.001",
    intrinsic_usd: "1.00",
    market_usd: "0.999",
    ...extra,
  } as AssetCardData;
}

const noop = () => {};

describe("DashboardBoardRow", () => {
  it("is a single Link straight to the asset page (click-through, no peek)", () => {
    const { container } = render(
      <DashboardBoardRow
        asset={mk()}
        state="PEGGED"
        bps={10}
        hasBps
        discount="0.001"
        jitter={1.2}
        jLabel="steady"
        riskScore={5}
        velocity={null}
        rowRef={noop}
        rovingActive
      />,
    );
    const link = container.querySelector("a");
    expect(link).toHaveAttribute("href", "/asset/USDX");
    expect(screen.getAllByText("USDX").length).toBeGreaterThan(0);
  });

  it("shows Capitalized state pill text via the canonical stateMeta labels", () => {
    render(
      <DashboardBoardRow
        asset={mk({ symbol: "DRFT" })}
        state="DRIFT"
        bps={45}
        hasBps
        discount="0.0045"
        jitter={8}
        jLabel="choppy"
        riskScore={22}
        velocity={1}
        rowRef={noop}
        rovingActive
      />,
    );
    expect(screen.getAllByText("Drift").length).toBeGreaterThan(0);
  });

  it("renders '—' for spread when hasBps is false (stale/missing), never a fake 0.00%", () => {
    render(
      <DashboardBoardRow
        asset={mk({ symbol: "STLE" })}
        state="UNKNOWN"
        bps={0}
        hasBps={false}
        discount={null}
        jitter={null}
        jLabel="unknown"
        riskScore={null}
        velocity={null}
        rowRef={noop}
        rovingActive
      />,
    );
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
    expect(screen.queryByText("0.00%")).not.toBeInTheDocument();
  });

  it("is out of the Tab order when not the roving-active row", () => {
    const { container } = render(
      <DashboardBoardRow
        asset={mk()}
        state="PEGGED"
        bps={10}
        hasBps
        discount="0.001"
        jitter={1.2}
        jLabel="steady"
        riskScore={5}
        velocity={null}
        rowRef={noop}
        rovingActive={false}
      />,
    );
    expect(container.querySelector("a")?.getAttribute("tabindex")).toBe("-1");
  });

  it("renders the numeric risk score in the Risk column", () => {
    render(
      <DashboardBoardRow
        asset={mk()}
        state="PEGGED"
        bps={10}
        hasBps
        discount="0.001"
        jitter={1.2}
        jLabel="steady"
        riskScore={14}
        velocity={null}
        rowRef={noop}
        rovingActive
      />,
    );
    expect(screen.getByText("14")).toBeInTheDocument();
  });

  it("passes klass through to BandGauge so a premium LST reads benign, not depegged (ADR-0021 carve-out)", () => {
    // bps follows reconcileBps convention (negative = premium, market ABOVE
    // intrinsic) — a benign LST premium must never fill the gauge or read
    // "off-scale/depegged" once `klass` is wired through from the row.
    render(
      <DashboardBoardRow
        asset={mk({ symbol: "mSOL", class: "lst" })}
        state="PEGGED"
        bps={-103}
        hasBps
        discount="-0.0103"
        jitter={1.2}
        jLabel="steady"
        riskScore={5}
        velocity={null}
        rowRef={noop}
        rovingActive
      />,
    );
    const gauge = screen.getByRole("img", { name: /benign/i });
    expect(gauge.getAttribute("aria-label")).not.toMatch(/off-scale|depegged/i);
    // The spread cell itself must read holder-signed too: a premium is `+`.
    expect(screen.getByText("+1.03%")).toBeInTheDocument();
  });
});
