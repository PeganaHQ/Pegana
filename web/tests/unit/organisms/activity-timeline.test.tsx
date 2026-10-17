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
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ActivityTimeline } from "@/components/organisms/activity-timeline";
import type { AlertRow } from "@/lib/api/types";

function mkAlert(overrides: Partial<AlertRow>): AlertRow {
  return {
    id: "a1",
    asset: "USDC",
    class: "stable_fiat",
    from_state: "PEGGED",
    to_state: "DRIFT",
    detected_at: "2026-07-10T12:00:00Z",
    dispatched_at: null,
    ...overrides,
  } as AlertRow;
}

describe("ActivityTimeline — timeline rows drive the chart scrub", () => {
  it("renders each row as a real button with an accessible 'Show chart at <time>' label", () => {
    render(<ActivityTimeline alerts={[mkAlert({})]} onScrub={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /show chart at/i });
    expect(btn).toBeInTheDocument();
  });

  it("calls onScrub with the event id, unix-seconds timestamp, and to_state on click", async () => {
    const onScrub = vi.fn();
    const user = userEvent.setup();
    render(
      <ActivityTimeline
        alerts={[mkAlert({ id: "evt-1", to_state: "DEPEG" })]}
        onScrub={onScrub}
      />,
    );
    await user.click(screen.getByRole("button", { name: /show chart at/i }));
    expect(onScrub).toHaveBeenCalledTimes(1);
    const [id, tsSec, state] = onScrub.mock.calls[0];
    expect(id).toBe("evt-1");
    expect(tsSec).toBe(Math.floor(Date.parse("2026-07-10T12:00:00Z") / 1000));
    expect(state).toBe("DEPEG");
  });

  it("marks the currently-scrubbed row as pressed", () => {
    render(
      <ActivityTimeline
        alerts={[mkAlert({ id: "evt-1" })]}
        onScrub={vi.fn()}
        scrubbedId="evt-1"
      />,
    );
    expect(
      screen.getByRole("button", { name: /show chart at/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("shows an honest 'outside loaded range' hint instead of silently no-opping", () => {
    render(
      <ActivityTimeline
        alerts={[mkAlert({ id: "evt-1" })]}
        onScrub={vi.fn()}
        outOfRangeId="evt-1"
      />,
    );
    expect(screen.getByText(/outside loaded range/i)).toBeInTheDocument();
  });

  it("does not show the hint for a row that wasn't flagged out of range", () => {
    render(
      <ActivityTimeline
        alerts={[mkAlert({ id: "evt-1" })]}
        onScrub={vi.fn()}
        outOfRangeId="some-other-row"
      />,
    );
    expect(screen.queryByText(/outside loaded range/i)).toBeNull();
  });

  it("renders rows as disabled, inert buttons when no onScrub handler is wired", () => {
    render(<ActivityTimeline alerts={[mkAlert({})]} />);
    expect(
      screen.getByRole("button", { name: /show chart at/i }),
    ).toBeDisabled();
  });
});
