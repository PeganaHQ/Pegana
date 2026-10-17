import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnimatedBrandMark } from "@/components/atoms/animated-brand-mark";

describe("AnimatedBrandMark", () => {
  it("keeps the 'egana' wordmark in the DOM — collapse is visual only, never removal", () => {
    render(<AnimatedBrandMark />);

    const wordmark = screen.getByText("egana");
    expect(wordmark).toBeInTheDocument();
    expect(wordmark).not.toHaveAttribute("aria-hidden");
    expect(wordmark).not.toHaveAttribute("hidden");
    // Collapse must be a max-width/opacity clip, never display:none — jsdom
    // doesn't compute layout, so we assert on the class contract instead of
    // pixel width. (Note: "overflow-hidden" legitimately contains "hidden"
    // as a substring — check for it as a standalone class token instead.)
    const classTokens = wordmark.className.split(/\s+/);
    expect(classTokens).not.toContain("hidden");
    expect(classTokens).not.toContain("display-none");
  });

  it("exposes a single accessible name 'Pegana' for the whole mark", () => {
    render(<AnimatedBrandMark />);

    expect(screen.getByRole("img", { name: "Pegana" })).toBeInTheDocument();
  });

  it("shows the full lockup (uncollapsed) immediately on mount", () => {
    render(<AnimatedBrandMark />);

    const wordmark = screen.getByText("egana");
    expect(wordmark.className).toContain("opacity-100");
    expect(wordmark.className).not.toContain("opacity-0");
  });

  it("never alters the winged-P gradient stops or path", () => {
    const { container } = render(<AnimatedBrandMark />);

    const stops = container.querySelectorAll("stop");
    const colors = Array.from(stops).map((s) => s.getAttribute("stop-color"));
    expect(colors).toEqual([
      "#ff8a1e",
      "#fd662c",
      "#f7269b",
      "#c02ef2",
      "#9b34fa",
    ]);
  });
});
