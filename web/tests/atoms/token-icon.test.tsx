import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TokenIcon } from "@/components/atoms/token-icon";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("TokenIcon", () => {
  it("renders an <img> pointing at the vendored webp for the mint", () => {
    const { container } = render(
      <TokenIcon mint={MINT} symbol="USDC" klass="stable_fiat" />,
    );
    const img = container.querySelector("img")!;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe(`/tokens/${MINT}.webp`);
  });

  it("falls back to a class-tinted monogram when the image errors", () => {
    const { container } = render(
      <TokenIcon mint={MINT} symbol="USDC" klass="stable_fiat" />,
    );
    const img = container.querySelector("img")!;
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("US")).toBeTruthy();
  });

  it("is decorative by default (aria-hidden, empty alt)", () => {
    const { container } = render(<TokenIcon mint={MINT} symbol="USDC" />);
    expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(container.querySelector("img")!.getAttribute("alt")).toBe("");
  });

  it("exposes an accessible label when not decorative", () => {
    render(<TokenIcon mint={MINT} symbol="USDC" decorative={false} />);
    expect(screen.getByRole("img", { name: "USDC logo" })).toBeTruthy();
  });
});
