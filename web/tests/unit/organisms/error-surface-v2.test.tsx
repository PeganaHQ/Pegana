import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorSurfaceV2 } from "@/components/organisms/v2/error-surface-v2";

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

describe("ErrorSurfaceV2", () => {
  it("does not render the standalone lockup or caption row", () => {
    const { container } = render(
      <ErrorSurfaceV2
        standalone
        eyebrow="Route not found"
        headline="This path is not published."
        sub="The feed is still available."
        state="unknown"
        endLabel="404"
        primary={{ label: "Back to home", href: "/" }}
        secondary={{ label: "Open dashboard", href: "/dashboard" }}
      />,
    );

    expect(container.querySelector("header")).toBeNull();
    expect(
      screen.queryByText("404 · any unmatched URL"),
    ).not.toBeInTheDocument();
  });
});
