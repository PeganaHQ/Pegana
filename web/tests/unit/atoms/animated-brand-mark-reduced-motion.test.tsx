import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedBrandMark } from "@/components/atoms/animated-brand-mark";

// Separate file: `vi.mock` is hoisted to module scope, so the reduced-motion
// override must not leak into the default-motion assertions in the sibling
// test file.
vi.mock("@/lib/motion/use-reduced-motion", () => ({
  useAppReducedMotion: () => true,
}));

describe("AnimatedBrandMark — prefers-reduced-motion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the full lockup expanded and never auto-collapses the wordmark", () => {
    render(<AnimatedBrandMark settleDelayMs={100} />);

    // Fast-forward well past the settle delay — under reduced motion the
    // mount timer must never fire the collapse.
    vi.advanceTimersByTime(5000);

    const wordmark = screen.getByText("egana");
    expect(wordmark.className).toContain("opacity-100");
    expect(wordmark.className).not.toContain("max-w-0");
  });
});
