import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuditEmptyState } from "@/components/molecules/audit-empty-state";

const API_BASE = "https://api.pegana.xyz";

describe("AuditEmptyState", () => {
  describe("kind=unreachable", () => {
    it("renders MUTED (no critical-red) when in calibration window", () => {
      render(
        <AuditEmptyState
          kind="unreachable"
          inCalibrationWindow={true}
          apiBase={API_BASE}
          stateFilter={null}
        />,
      );
      expect(
        screen.getByTestId("audit-empty-unreachable-calm"),
      ).toBeInTheDocument();
      expect(screen.getByText(/audit api offline/i)).toBeInTheDocument();
      // It references the API base so the operator can debug.
      expect(screen.getByText(/api\.pegana\.xyz/)).toBeInTheDocument();
      // Banner-aware copy: defer the calibration narrative to the global banner.
      expect(screen.getByText(/calibration banner above/i)).toBeInTheDocument();
    });

    it("renders CRITICAL when post-gate (banner is gone, alarm is appropriate)", () => {
      render(
        <AuditEmptyState
          kind="unreachable"
          inCalibrationWindow={false}
          apiBase={API_BASE}
          stateFilter={null}
        />,
      );
      expect(
        screen.getByTestId("audit-empty-unreachable-critical"),
      ).toBeInTheDocument();
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/audit api unreachable/i)).toBeInTheDocument();
    });
  });

  describe("kind=calibration", () => {
    it("renders drift-tinted calibration narrative with /methodology link", () => {
      render(
        <AuditEmptyState
          kind="calibration"
          inCalibrationWindow={true}
          apiBase={API_BASE}
          stateFilter={null}
        />,
      );
      expect(screen.getByTestId("audit-empty-calibration")).toBeInTheDocument();
      expect(
        screen.getByText(/calibration window · gate Jun 11, 2026/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/dogfood mode/i)).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /Read \/methodology/i }),
      ).toHaveAttribute("href", "/methodology");
    });
  });

  describe("kind=post-gate-empty", () => {
    it("renders neutral hairline message", () => {
      render(
        <AuditEmptyState
          kind="post-gate-empty"
          inCalibrationWindow={false}
          apiBase={API_BASE}
          stateFilter={null}
        />,
      );
      expect(screen.getByTestId("audit-empty-post-gate")).toBeInTheDocument();
      expect(
        screen.getByText(/no recent non-pegged alerts/i),
      ).toBeInTheDocument();
    });

    it("includes the active state filter in the empty message when set", () => {
      render(
        <AuditEmptyState
          kind="post-gate-empty"
          inCalibrationWindow={false}
          apiBase={API_BASE}
          stateFilter="DRIFT"
        />,
      );
      expect(screen.getByText(/for state DRIFT/i)).toBeInTheDocument();
    });
  });
});
