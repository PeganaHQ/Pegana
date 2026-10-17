import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CalibrationBanner } from "@/components/molecules/calibration-banner";

describe("CalibrationBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("inside the calibration window", () => {
    beforeEach(() => {
      vi.setSystemTime(new Date("2026-05-29T12:00:00Z"));
    });

    it("renders the floating trigger pill", () => {
      render(<CalibrationBanner />);
      const trigger = screen.getByRole("button", {
        name: /open calibration window details/i,
      });
      expect(trigger).toBeInTheDocument();
      expect(trigger).toHaveTextContent(/calibration window/i);
      expect(trigger).toHaveTextContent(/launched/i);
      expect(trigger).toHaveTextContent(/June 11, 2026/);
    });

    it("does NOT surface a 'Nd to gate' countdown (staleness-prone)", () => {
      const { container } = render(<CalibrationBanner />);
      expect(container.textContent).not.toMatch(/\d+d to gate/);
    });

    it("opens a dialog with the trust narrative when the trigger is clicked", () => {
      render(<CalibrationBanner />);
      const trigger = screen.getByRole("button", {
        name: /open calibration window details/i,
      });
      // Pre-click: dialog content is not in the DOM.
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      fireEvent.click(trigger);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      // The dialog body contains the calibration explainer + launch checkpoint.
      expect(
        within(dialog).getAllByText(/calibration window/i).length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        within(dialog).getByText(/Public launch checkpoint:/i),
      ).toBeInTheDocument();
      // "June 11, 2026" appears multiple times (header + timeline marker).
      expect(
        within(dialog).getAllByText(/June 11, 2026/).length,
      ).toBeGreaterThanOrEqual(2);
    });

    it("dialog includes the three trust pillars + timeline markers", () => {
      render(<CalibrationBanner />);
      fireEvent.click(
        screen.getByRole("button", {
          name: /open calibration window details/i,
        }),
      );
      const dialog = screen.getByRole("dialog");
      // Pillar titles (uniquely worded so the matchers are unambiguous)
      expect(within(dialog).getByText(/What we measure/i)).toBeInTheDocument();
      expect(
        within(dialog).getByText(/Why receipts matter/i),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText(/What launched at the gate/i),
      ).toBeInTheDocument();
      // Pillar numbers — exact match avoids colliding with date substrings.
      expect(within(dialog).getByText("01")).toBeInTheDocument();
      expect(within(dialog).getByText("02")).toBeInTheDocument();
      expect(within(dialog).getByText("03")).toBeInTheDocument();
      // Timeline anchors — "dogfood" appears in both the header description
      // and the timeline marker label, so we assert at least one match per term.
      expect(
        within(dialog).getAllByText(/deploy/i).length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        within(dialog).getAllByText(/dogfood/i).length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        within(dialog).getAllByText(/launch gate/i).length,
      ).toBeGreaterThanOrEqual(1);
    });

    // (Removed) The banner no longer exposes an external ADR link — ADRs were
    // pulled from the user-facing UI on 2026-06-03. The footer links below are
    // the only outbound links now.

    it("dialog footer links to /methodology and /audit", () => {
      render(<CalibrationBanner />);
      fireEvent.click(
        screen.getByRole("button", {
          name: /open calibration window details/i,
        }),
      );
      const dialog = screen.getByRole("dialog");
      expect(
        within(dialog).getByRole("link", { name: /^Methodology$/i }),
      ).toHaveAttribute("href", "/methodology");
      expect(
        within(dialog).getByRole("link", { name: /^Audit ledger$/i }),
      ).toHaveAttribute("href", "/audit");
    });
  });

  describe("at and after the verdict gate", () => {
    it("renders nothing AT the gate exactly", () => {
      vi.setSystemTime(new Date("2026-06-11T00:00:00Z"));
      const { container } = render(<CalibrationBanner />);
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing one minute after the gate", () => {
      vi.setSystemTime(new Date("2026-06-11T00:01:00Z"));
      const { container } = render(<CalibrationBanner />);
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing a year after the gate", () => {
      vi.setSystemTime(new Date("2027-12-01T00:00:00Z"));
      const { container } = render(<CalibrationBanner />);
      expect(container.firstChild).toBeNull();
    });
  });
});
