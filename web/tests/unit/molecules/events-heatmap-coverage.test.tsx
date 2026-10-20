import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/lib/motion/use-reduced-motion-gsap", () => ({
  useReducedMotionGsap: () => undefined,
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { EventsHeatmap } from "@/components/molecules/events-heatmap";

const dayOffset = (n: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

describe("EventsHeatmap coverage floor", () => {
  it("marks days at or before the floor as not loaded, never as quiet", () => {
    const floor = dayOffset(200);
    const { container } = render(
      <TooltipProvider>
        <EventsHeatmap buckets={{}} unknownThroughDay={floor} />
      </TooltipProvider>,
    );
    const unknown = container.querySelectorAll('[data-unknown="true"]');
    expect(unknown.length).toBeGreaterThan(0);
    for (const el of unknown) {
      expect(el.getAttribute("aria-label")).toContain("coverage incomplete");
    }
    // Recent days are still ordinary cells.
    expect(
      container.querySelectorAll("[data-heatmap-cell]:not([data-unknown])").length,
    ).toBeGreaterThan(0);
  });

  it("marks nothing unknown when coverage is complete", () => {
    const { container } = render(
      <TooltipProvider>
        <EventsHeatmap buckets={{}} />
      </TooltipProvider>,
    );
    expect(container.querySelectorAll('[data-unknown="true"]')).toHaveLength(0);
  });
});
