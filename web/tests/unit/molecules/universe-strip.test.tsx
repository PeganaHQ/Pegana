import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { UniverseStrip } from "@/components/molecules/universe-strip";

describe("UniverseStrip", () => {
  it("renders the universe size + ops facts — with a real relative timestamp, no placeholder", () => {
    render(
      <UniverseStrip
        tracked={63}
        alerts24h={0}
        deliverySent={12}
        deliveryFailed={0}
        updatedAgo="8s ago"
      />,
    );
    // Craft pass (2026-07-14): the composition SPLIT (Pegged N / Drift+ N)
    // moved out of the strip — DashboardVerdict's headline owns that narrative
    // one line below. What stays: the universe SIZE (an anchor the verdict only
    // implies on a drift day) plus the ops facts that live nowhere else.
    expect(screen.getByText("63 tracked")).toBeInTheDocument();
    expect(screen.getByText("alerts 24h 0")).toBeInTheDocument();
    expect(screen.getByText("delivery 12/12")).toBeInTheDocument();
    expect(screen.getByText("updated 8s ago")).toBeInTheDocument();
  });

  it("omits the updated fact entirely (not a dash) when no timestamp is available yet", () => {
    render(
      <UniverseStrip
        tracked={63}
        alerts24h={0}
        deliverySent={0}
        deliveryFailed={0}
      />,
    );
    expect(screen.queryByText(/updated/)).not.toBeInTheDocument();
  });

  it("omits the delivery fact entirely when nothing was dispatched in the last 24h", () => {
    render(
      <UniverseStrip
        tracked={63}
        alerts24h={0}
        deliverySent={0}
        deliveryFailed={0}
        updatedAgo="8s ago"
      />,
    );
    expect(screen.queryByText(/delivery/)).not.toBeInTheDocument();
  });
});
