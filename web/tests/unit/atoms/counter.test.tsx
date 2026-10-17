import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Counter } from "@/components/atoms/counter";

describe("Counter", () => {
  it("renders target value when reduced-motion is preferred", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    render(<Counter target={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});
