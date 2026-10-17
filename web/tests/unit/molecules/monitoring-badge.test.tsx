import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  MonitoringBadge,
  BETA_BADGE_LABEL,
  BETA_BADGE_BODY,
} from "@/components/molecules/monitoring-badge";

function renderBadge(props: Record<string, unknown> = {}) {
  return render(
    <TooltipProvider>
      <MonitoringBadge {...props} />
    </TooltipProvider>,
  );
}

describe("MonitoringBadge → beta label", () => {
  it("shows 'beta' as the visible badge text (not the old 'monitoring')", () => {
    renderBadge();
    expect(screen.getByText(BETA_BADGE_LABEL)).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.queryByText("monitoring")).toBeNull();
  });
});

describe("MonitoringBadge → professional copy (no engineer jargon)", () => {
  // Regression lock for the exact complaint: the hover used to echo the raw
  // API reason ("Phase-0 launch activation… p95… 7-day retro") + an ISO date.
  const JARGON = [
    "phase-0",
    "phase 0",
    "p95",
    "calibration v1",
    "denominator",
    "monitoring since",
    "7-day retro",
    "structural anomaly",
  ];

  it("reads as a clean provisional-calibration explanation", () => {
    expect(BETA_BADGE_BODY).toMatch(/provisional calibration/i);
  });

  it("contains none of the internal vocabulary", () => {
    const body = BETA_BADGE_BODY.toLowerCase();
    for (const term of JARGON) {
      expect(body).not.toContain(term);
    }
  });

  it("never leaks a raw ISO date", () => {
    expect(BETA_BADGE_BODY).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
