import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AssetsCanon,
  type CanonAsset,
} from "@/components/organisms/assets-canon";

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

const baseAssets: CanonAsset[] = [
  {
    symbol: "jitoSOL",
    name: "Jito Liquid Staking",
    mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    className: "lst",
    pegTarget: "SOL",
    verified: true,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    className: "stable_fiat",
    pegTarget: "USD",
    verified: true,
  },
  ...Array.from({ length: 7 }, (_, i) => ({
    symbol: `T${i}`,
    name: `Test Asset ${i}`,
    mint: `Mint${i}`,
    className: "stable_fiat",
    pegTarget: "USD",
    verified: i % 2 === 0,
  })),
];

describe("AssetsCanon", () => {
  it("renders token icons, full names, clickable rows, and an expanding disclosure", () => {
    const { container } = render(<AssetsCanon assets={baseAssets} />);

    const firstRow = screen.getByRole("link", { name: /jitoSOL/i });
    expect(firstRow).toHaveAttribute("href", "/asset/jitoSOL");
    expect(screen.getByText("Jito Liquid Staking")).toBeInTheDocument();
    expect(firstRow.querySelector("img")).toHaveAttribute(
      "src",
      "https://api.pegana.xyz/static/tokens/J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn.webp",
    );
    expect(container.querySelector(".v2-in-tokico")).toBeNull();
    const table = screen.getByRole("table", { name: "Canonical tracked assets" });
    expect(table.tagName).toBe("TABLE");
    expect(table).not.toHaveAttribute("role");
    expect(table.querySelector("thead")).not.toHaveAttribute("role");
    expect(table.querySelector("tbody")).not.toHaveAttribute("role");
    expect(table.querySelector('tr[role="row"]')).toBeInTheDocument();
    expect(table.querySelector("th")).not.toHaveAttribute("role");
    expect(table.querySelector("td")).not.toHaveAttribute("role");

    expect(screen.queryByText("Test Asset 6")).not.toBeInTheDocument();
    const disclosure = screen.getByRole("button", { name: "Show all 9" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(disclosure);

    expect(screen.getByText("Test Asset 6")).toBeInTheDocument();
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(disclosure).toHaveTextContent("Show less");
  });
});
