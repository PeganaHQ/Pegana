import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MockDataBanner } from "@/components/molecules/mock-data-banner";

describe("MockDataBanner", () => {
  it("renders when show=true with the explanatory copy", () => {
    render(<MockDataBanner show />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/showing sample data/i)).toBeInTheDocument();
  });
  it("returns nothing when show=false", () => {
    const { container } = render(<MockDataBanner show={false} />);
    expect(container.firstChild).toBeNull();
  });
});
