import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HeroV2 } from "@/components/organisms/v2/hero-v2";
import { SourcesV2 } from "@/components/organisms/v2/sources-v2";
import { LOGO_ITEMS } from "@/components/organisms/v2/shared";

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

vi.mock("@/lib/hooks/use-assets", () => ({
  useAssets: () => ({ data: undefined }),
}));

vi.mock("@/lib/hooks/use-stats", () => ({
  useStats: () => ({ data: undefined }),
}));

vi.mock("@/lib/motion/use-reduced-motion", () => ({
  useAppReducedMotion: () => true,
}));

vi.mock("@/lib/motion/use-reveal-v2", () => ({
  useRevealV2: () => ({ ref: { current: null }, style: {}, inView: true }),
}));

vi.mock("@/components/organisms/v2/distance-field-canvas", () => ({
  DistanceFieldCanvas: () => null,
}));

vi.mock("@/components/organisms/v2/hero-reveal-canvas", () => ({
  HeroRevealCanvas: () => null,
}));

vi.mock("@/components/organisms/v2/spread-spark-canvas", () => ({
  SpreadSparkCanvas: () => <span data-testid="spread-spark" />,
}));

// Both hooks are mocked to `data: undefined` above — i.e. the live list has NOT
// loaded. This file used to assert that a hardcoded "69" was painted in that
// state, which pinned the bug rather than the contract: the real number was 68,
// and the mock-mode banner only fires when BOTH /v1/stats and /v1/assets fail, so
// a single-endpoint blip rendered a confident wrong count on the most-viewed
// page. On a product whose pitch is "don't trust the score, replay it", an
// em-dash is strictly better than a stale number.
describe("V2 asset count when the live list is unavailable", () => {
  it("omits the count from the board pill rather than inventing one", () => {
    render(<HeroV2 />);

    expect(screen.getByRole("button", { name: "all" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /all · \d+/ })).toBeNull();
  });

  it("renders an em-dash instead of a hardcoded total in the sources stats", () => {
    render(<SourcesV2 />);

    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.queryByText("69")).toBeNull();
    expect(
      screen.getByText(
        "assets monitored across stables, LSTs, yield, CDP and synthetic classes",
      ),
    ).toBeInTheDocument();
  });

  it("derives the issuers/venues stat from the logo strip so it cannot drift", () => {
    render(<SourcesV2 />);

    // The strip previously carried Drift (dSOL) and Piggybank (pbUSDC) — both
    // deactivated and absent from the live 68 — under a hardcoded "14 issuers".
    expect(screen.getByText(String(LOGO_ITEMS.length))).toBeInTheDocument();
    expect(
      screen.getByText("issuers, venues and oracles behind the numbers"),
    ).toBeInTheDocument();
    expect(LOGO_ITEMS.some((l) => l.slug === "drift")).toBe(false);
    expect(LOGO_ITEMS.some((l) => l.slug === "piggybank")).toBe(false);
  });
});
