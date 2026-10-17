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
import { describe, it, expect } from "vitest";
import { BandGauge } from "@/components/atoms/band-gauge";
import type { AlertThresholds } from "@/lib/alerts/policy";

const USDC: AlertThresholds = {
  drift_bps: 15,
  depeg_bps: 50,
  critical_bps: 200,
};

describe("BandGauge — UNKNOWN gate (proximity value suppressed)", () => {
  it("shows '—' instead of a percentage when state is UNKNOWN", () => {
    render(<BandGauge bps={1690} thresholds={USDC} state="UNKNOWN" />);
    // The '-' placeholder must be present.
    expect(screen.getByText("-")).toBeInTheDocument();
    // A numeric percentage must NOT appear (the gauge bar itself is also hidden).
    expect(screen.queryByRole("img", { name: /depeg line/i })).toBeNull();
  });

  it("does NOT render a gauge bar (role=img) when state is UNKNOWN", () => {
    render(<BandGauge bps={40} thresholds={USDC} state="UNKNOWN" />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("DOES render the gauge bar (role=img) when state is PEGGED", () => {
    render(<BandGauge bps={40} thresholds={USDC} state="PEGGED" />);
    expect(
      screen.getByRole("img", { name: /depeg line/i }),
    ).toBeInTheDocument();
  });

  it("DOES render a percentage label when state is DRIFT", () => {
    render(<BandGauge bps={40} thresholds={USDC} state="DRIFT" showValue />);
    // 40/50 = 80%
    expect(screen.getByText("80%")).toBeInTheDocument();
  });
});

// The engine sign convention (reconcileBps / discountToBps, verified against
// live snapshots): discount = (intrinsic - market)/intrinsic, so
//   bps > 0  ⟺ market BELOW intrinsic  ⟺ a DISCOUNT  ("below intrinsic")
//   bps < 0  ⟺ market ABOVE intrinsic  ⟺ a PREMIUM   ("above intrinsic")
// Every BandGauge caller (table, mobile, preview, rail) feeds reconcileBps's
// bps, so the spoken direction must follow this convention.
describe("BandGauge — direction label follows the engine sign convention", () => {
  it("announces a positive bps (market below NAV = discount) as 'below intrinsic'", () => {
    render(<BandGauge bps={40} thresholds={USDC} state="DRIFT" />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(
      /below intrinsic/i,
    );
  });

  it("announces a negative bps (market above NAV = premium) as 'above intrinsic'", () => {
    render(<BandGauge bps={-40} thresholds={USDC} state="DRIFT" />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(
      /above intrinsic/i,
    );
  });

  it("reads 'at intrinsic' at a perfect peg", () => {
    render(<BandGauge bps={0} thresholds={USDC} state="PEGGED" />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(
      /at intrinsic/i,
    );
  });

  it("caps off-scale assets at 100% and calls out the depegged treatment", () => {
    render(<BandGauge bps={911} thresholds={USDC} state="DEPEG" />);

    const gauge = screen.getByRole("img");
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(gauge.getAttribute("aria-label")).toContain("100% of the way");
    expect(gauge.getAttribute("aria-label")).toMatch(/off-scale \/ depegged/i);
    expect(gauge.getAttribute("aria-label")).not.toMatch(/1822%|999%/);
  });
});

// A Pegged LST trading at a premium (e.g. mSOL ~+1.03%) must read CALM, not
// "100% / off-scale / depegged" — the exact regression this pass fixes.
describe("BandGauge — direction-sensitive premium carve-out (ADR-0021, klass prop)", () => {
  const MSOL: AlertThresholds = {
    drift_bps: 40,
    depeg_bps: 100,
    critical_bps: 250,
  };

  it("a benign LST premium (bps < 0) never fills, never off-scale, never says 'depegged'", () => {
    // bps = -103 ⇒ ~1.03% premium (market ABOVE intrinsic) — same magnitude
    // as the reported mSOL bug (|bps|/depeg_bps = 103/100 = 103% before the
    // fix, i.e. capped display "100% ... off-scale / depegged").
    render(
      <BandGauge bps={-103} thresholds={MSOL} state="PEGGED" klass="lst" />,
    );
    const gauge = screen.getByRole("img");
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(gauge.getAttribute("aria-label")).not.toMatch(/100%/);
    expect(gauge.getAttribute("aria-label")).not.toMatch(/off-scale|depegged/i);
    expect(gauge.getAttribute("aria-label")).toMatch(/benign/i);
  });

  it("the SAME magnitude reads off-scale/depegged without klass (symmetric fallback, unchanged behavior)", () => {
    render(<BandGauge bps={-103} thresholds={MSOL} state="DEPEG" />);
    const gauge = screen.getByRole("img");
    expect(gauge.getAttribute("aria-label")).toMatch(/off-scale \/ depegged/i);
  });

  it("a genuine LST discount (bps > 0) still counts fully toward the depeg band", () => {
    render(<BandGauge bps={103} thresholds={MSOL} state="DRIFT" klass="lst" />);
    const gauge = screen.getByRole("img");
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(gauge.getAttribute("aria-label")).toMatch(/off-scale \/ depegged/i);
  });

  it("a stable_fiat premium of the same magnitude is NOT carved out (symmetric class)", () => {
    render(
      <BandGauge
        bps={-103}
        thresholds={MSOL}
        state="DEPEG"
        klass="stable_fiat"
      />,
    );
    const gauge = screen.getByRole("img");
    expect(gauge.getAttribute("aria-label")).toMatch(/off-scale \/ depegged/i);
  });
});
