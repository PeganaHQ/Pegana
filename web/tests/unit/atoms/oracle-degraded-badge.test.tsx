import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OracleDegradedBadge } from "@/components/atoms/oracle-degraded-badge";
import type { OracleDegraded } from "@/lib/api/types";

vi.mock("@/components/atoms/help-icon", () => ({
  HelpIcon: () => <span data-testid="help-icon" />,
}));

const FRESH = new Date(Date.now() - 30_000).toISOString(); // 30s ago
const STALE = new Date(Date.now() - 20 * 60_000).toISOString(); // 20min ago

describe("OracleDegradedBadge", () => {
  it("renders nothing when oracleDegraded is absent", () => {
    const { container } = render(
      <OracleDegradedBadge oracleDegraded={null} updatedAt={FRESH} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the reading is stale, even if actively degraded", () => {
    const degraded: OracleDegraded = {
      reason: "oracle_divergence",
      spread_bps: 142,
    };
    const { container } = render(
      <OracleDegradedBadge oracleDegraded={degraded} updatedAt={STALE} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the divergence label + spread_bps metric when fresh", () => {
    const degraded: OracleDegraded = {
      reason: "oracle_divergence",
      spread_bps: 142,
    };
    render(<OracleDegradedBadge oracleDegraded={degraded} updatedAt={FRESH} />);
    expect(screen.getByText("Oracle diverges")).toBeInTheDocument();
    expect(screen.getByText("· 142bps")).toBeInTheDocument();
  });

  it("renders the wide-confidence label + conf_bps metric when fresh", () => {
    const degraded: OracleDegraded = {
      reason: "oracle_confidence_wide",
      conf_bps: 230,
    };
    render(<OracleDegradedBadge oracleDegraded={degraded} updatedAt={FRESH} />);
    expect(screen.getByText("Oracle conf wide")).toBeInTheDocument();
    expect(screen.getByText("· 230bps")).toBeInTheDocument();
  });

  it("renders the stale label + age_secs metric when fresh", () => {
    const degraded: OracleDegraded = {
      reason: "oracle_stale",
      age_secs: 95,
    };
    render(<OracleDegradedBadge oracleDegraded={degraded} updatedAt={FRESH} />);
    expect(screen.getByText("Oracle stale")).toBeInTheDocument();
    expect(screen.getByText("· 95s")).toBeInTheDocument();
  });

  it("uses the amber drift token, never the depeg/critical rose", () => {
    const degraded: OracleDegraded = {
      reason: "oracle_divergence",
      spread_bps: 142,
    };
    render(<OracleDegradedBadge oracleDegraded={degraded} updatedAt={FRESH} />);
    const flag = screen.getByText("Oracle diverges").closest("div");
    expect(flag).toHaveClass("text-st-drift");
    expect(flag?.className).not.toMatch(/st-depeg|st-critical/);
  });
});
