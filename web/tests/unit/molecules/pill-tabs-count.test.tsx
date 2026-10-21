import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PillTabs } from "@/components/molecules/pill-tabs";

describe("PillTabs count", () => {
  it("renders an en dash, never 0, for an unknown (null) count", () => {
    render(
      <PillTabs
        items={[
          { key: "a", label: "All", count: null },
          { key: "b", label: "Big", count: 1234 },
          { key: "c", label: "Zero", count: 0 },
          { key: "d", label: "None" },
        ]}
        value="a"
        onChange={() => {}}
        ariaLabel="Test"
      />,
    );
    expect(screen.getByRole("button", { name: /All/ }).textContent).toBe(
      "All–",
    );
    expect(screen.getByRole("button", { name: /Big/ }).textContent).toBe(
      "Big1,234",
    );
    expect(screen.getByRole("button", { name: /Zero/ }).textContent).toBe(
      "Zero0",
    );
    expect(screen.getByRole("button", { name: /None/ }).textContent).toBe(
      "None",
    );
  });
});
