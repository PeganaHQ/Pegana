import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TokenIcon } from "@/components/atoms/token-icon";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("TokenIcon", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders an <img> pointing at the vendored webp on the API box", () => {
    const { container } = render(
      <TokenIcon mint={MINT} symbol="USDC" klass="stable_fiat" />,
    );
    const img = container.querySelector("img")!;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe(
      `https://api.pegana.xyz/static/tokens/${MINT}.webp`,
    );
    // Explicit box so a slow icon never shifts the row.
    expect(img.getAttribute("width")).toBe("24");
    expect(img.getAttribute("height")).toBe("24");
  });

  it("serves the icon same-origin when NEXT_PUBLIC_STATIC_BASE is '/'", () => {
    vi.stubEnv("NEXT_PUBLIC_STATIC_BASE", "/");
    const { container } = render(<TokenIcon mint={MINT} symbol="USDC" />);
    expect(container.querySelector("img")!.getAttribute("src")).toBe(
      `/tokens/${MINT}.webp`,
    );
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
