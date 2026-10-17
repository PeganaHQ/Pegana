import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/link", () => ({
  default: React.forwardRef<
    HTMLAnchorElement,
    { children?: React.ReactNode; href?: string }
  >(function MockLink({ children, ...props }, ref) {
    return (
      <a ref={ref} {...props}>
        {children}
      </a>
    );
  }),
}));

// TokenIcon renders an <img> against a vendored /tokens path — irrelevant to
// this test and noisy in jsdom (no network), stub it to a plain span.
vi.mock("@/components/atoms/token-icon", () => ({
  TokenIcon: ({ symbol }: { symbol: string }) => (
    <span data-testid="token-icon">{symbol}</span>
  ),
}));

import { AnswerCard } from "@/components/molecules/answer-card";

describe("AnswerCard", () => {
  it("renders as a single whole-card link to the asset page (click straight through, no peek)", () => {
    render(
      <AnswerCard
        eyebrow="Closest to its band"
        href="/asset/USDT"
        symbol="USDT"
        name="Tether"
        mint="mint-usdt"
        klass="stable_fiat"
        metric="20 bps away"
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/asset/USDT");
    expect(link).toContainElement(screen.getByText("Tether"));
    expect(screen.getByText("20 bps away")).toBeInTheDocument();
    expect(screen.getByText("Closest to its band")).toBeInTheDocument();
  });

  it("renders children (gauge/sparkline slot) below the metric", () => {
    render(
      <AnswerCard
        eyebrow="Most volatile 24h"
        href="/asset/JupSOL"
        symbol="JupSOL"
        name="Jupiter Staked SOL"
        mint="mint-jupsol"
        klass="lst"
        metric="±12.4 bps"
      >
        <div data-testid="spark-slot">spark</div>
      </AnswerCard>,
    );
    expect(screen.getByTestId("spark-slot")).toBeInTheDocument();
  });
});
