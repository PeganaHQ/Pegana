import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IntrinsicDegradedBadge } from "@/components/atoms/intrinsic-degraded-badge";
import type { LstLivenessFlags } from "@/lib/asset/intrinsic-degraded";

vi.mock("@/components/atoms/help-icon", () => ({
  HelpIcon: () => <span data-testid="help-icon" />,
}));

const flags = (o: Partial<LstLivenessFlags>): LstLivenessFlags => ({
  stale: false,
  deprecated: false,
  dead: false,
  ...o,
});

describe("IntrinsicDegradedBadge", () => {
  it("renders nothing when flags are absent", () => {
    const { container } = render(<IntrinsicDegradedBadge flags={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a healthy backing (all flags false)", () => {
    const { container } = render(<IntrinsicDegradedBadge flags={flags({})} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the dead label (worst-first over deprecated/stale)", () => {
    render(
      <IntrinsicDegradedBadge
        flags={flags({ dead: true, deprecated: true, stale: true })}
      />,
    );
    expect(screen.getByText("Backing dead")).toBeInTheDocument();
  });

  it("renders the deprecated label", () => {
    render(<IntrinsicDegradedBadge flags={flags({ deprecated: true })} />);
    expect(screen.getByText("Backing deprecated")).toBeInTheDocument();
  });

  it("renders the stale label", () => {
    render(<IntrinsicDegradedBadge flags={flags({ stale: true })} />);
    expect(screen.getByText("Backing stale")).toBeInTheDocument();
  });

  it("uses the amber drift token, never the depeg/critical rose", () => {
    render(<IntrinsicDegradedBadge flags={flags({ stale: true })} />);
    const flag = screen.getByText("Backing stale").closest("div");
    expect(flag).toHaveClass("text-st-drift");
    expect(flag?.className).not.toMatch(/st-depeg|st-critical/);
  });
});
