import React from "react";
import { renderToString } from "react-dom/server";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeroV2, boardStatus } from "@/components/organisms/v2/hero-v2";
import type { AssetCardData } from "@/lib/api/types";

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

let swr: {
  data?: AssetCardData[];
  error?: unknown;
  mutate: ReturnType<typeof vi.fn>;
} = { mutate: vi.fn() };
vi.mock("@/lib/hooks/use-assets", () => ({
  useAssets: () => swr,
}));
vi.mock("@/lib/motion/use-reduced-motion", () => ({
  useAppReducedMotion: () => true,
}));
vi.mock("@/components/organisms/v2/distance-field-canvas", () => ({
  DistanceFieldCanvas: () => null,
}));
vi.mock("@/components/organisms/v2/hero-reveal-canvas", () => ({
  HeroRevealCanvas: () => null,
}));
vi.mock("@/components/organisms/v2/spread-spark-canvas", () => ({
  SpreadSparkCanvas: () => <span data-testid="spread-spark" />,
}));

function asset(overrides: Partial<AssetCardData>): AssetCardData {
  return {
    symbol: "X",
    name: "X",
    mint: "mint",
    class: "lst",
    peg_target: "SOL",
    decimals: 9,
    state: "PEGGED",
    discount: null,
    intrinsic_usd: "121.09",
    market_usd: "120.96",
    risk_score: null,
    market_cap: null,
    circulating_supply: null,
    liquidity_usd: null,
    volume_24h_usd: null,
    holder_count: null,
    market_context_at: null,
    updated_at: new Date().toISOString(),
    thresholds: { drift_bps: 55, depeg_bps: 140, critical_bps: 300 },
    ...overrides,
  };
}

// Values from the retired sample board; none of them may ever be painted.
const SAMPLE_VALUES = ["176.42", "177.15", "0.9772", "2.34%", "sample"];

function boardText(): string {
  return screen.getByRole("table", { name: "Live peg board" }).textContent ?? "";
}

beforeEach(() => {
  swr = { mutate: vi.fn() };
});

describe("boardStatus", () => {
  it("only claims live over real data", () => {
    expect(boardStatus({ hasData: true, hasError: false })).toBe("live");
    expect(boardStatus({ hasData: true, hasError: true })).toBe("reconnecting");
    expect(boardStatus({ hasData: false, hasError: false })).toBe("loading");
    expect(boardStatus({ hasData: false, hasError: true })).toBe("unavailable");
    expect(
      boardStatus({ hasData: false, hasError: true, rateLimited: true }),
    ).toBe("rate_limited");
    expect(
      boardStatus({ hasData: true, hasError: true, rateLimited: true }),
    ).toBe("rate_limited");
  });
});

describe("HeroV2 live board: never invented rows", () => {
  it("SSR HTML paints a skeleton, no LIVE pill and no sample numbers", () => {
    const html = renderToString(<HeroV2 />);
    expect(html).not.toContain("live · 60s");
    for (const v of SAMPLE_VALUES) expect(html).not.toContain(v);
    expect(html).toContain('data-status="loading"');
    expect(html.match(/data-testid="board-skeleton-row"/g)).toHaveLength(8);
  });

  it("SSR HTML renders the LCP h1 and sub visible (no opacity:0)", () => {
    const html = renderToString(<HeroV2 />);
    const h1 = html.match(/<h1[^>]*>/)![0];
    expect(h1).not.toMatch(/opacity:\s*0/);
    expect(h1).toContain("v2-hero-rise");
    const sub = html.match(/<p[^>]*v2-hero-rise[^>]*>/)![0];
    expect(sub).not.toMatch(/opacity:\s*0/);
  });

  it("a 429 reads as a rate limit with the app-wide wording, never 'offline'", () => {
    swr = { error: Object.assign(new Error("API 429"), { status: 429 }), mutate: vi.fn() };
    render(<HeroV2 />);
    expect(screen.getByTestId("board-status")).toHaveTextContent("rate limited");
    expect(screen.getByTestId("board-status")).not.toHaveTextContent("offline");
    expect(screen.getByTestId("board-rate-limited")).toHaveTextContent(
      /allows 60 requests a minute per IP/,
    );
    expect(screen.queryByTestId("board-unavailable")).toBeNull();
  });

  it("a failed fetch shows an explicit unavailable state with a working retry", () => {
    swr = { error: new Error("network"), mutate: vi.fn() };
    render(<HeroV2 />);
    expect(screen.getByTestId("board-status")).toHaveTextContent("offline");
    expect(screen.getByTestId("board-unavailable")).toBeInTheDocument();
    for (const v of SAMPLE_VALUES) expect(boardText()).not.toContain(v);
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    expect(swr.mutate).toHaveBeenCalledTimes(1);
  });

  it("real data shows the live pill and only real rows", () => {
    swr = {
      data: [asset({ symbol: "BNSOL", market_usd: "120.50" }), asset({ symbol: "USDS", class: "stable_cdp", intrinsic_usd: "1.0000", market_usd: "0.9998" })],
      mutate: vi.fn(),
    };
    render(<HeroV2 />);
    expect(screen.getByTestId("board-status")).toHaveTextContent("live · 60s");
    const table = screen.getByRole("table", { name: "Live peg board" });
    expect(within(table).getByText("BNSOL")).toBeInTheDocument();
    expect(within(table).getByText("120.50")).toBeInTheDocument();
    // BNSOL: a 49 bps discount is 35% of its 140 bps depeg line, and USDS's
    // 2 bps is 1%: a real per-asset reading, not a constant 8% per state.
    expect(within(table).getByText("35%")).toBeInTheDocument();
    expect(within(table).getByText("1%")).toBeInTheDocument();
  });
});

describe("HeroV2 board filter tabs", () => {
  it("are real toggle buttons that filter the rows", () => {
    swr = {
      data: [
        asset({ symbol: "BNSOL", class: "lst" }),
        asset({ symbol: "USDC", class: "stable_fiat", intrinsic_usd: "1.0000", market_usd: "0.9999" }),
        asset({ symbol: "sUSD", class: "stable_yield", intrinsic_usd: "1.0006", market_usd: "1.0001" }),
      ],
      mutate: vi.fn(),
    };
    render(<HeroV2 />);
    const all = screen.getByRole("button", { name: "all · 3" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    const lsts = screen.getByRole("button", { name: "LSTs" });
    expect(lsts).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(lsts);
    expect(lsts).toHaveAttribute("aria-pressed", "true");
    const table = screen.getByRole("table", { name: "Live peg board" });
    expect(within(table).getByText("BNSOL")).toBeInTheDocument();
    expect(within(table).queryByText("USDC")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "stables" }));
    expect(within(table).getByText("USDC")).toBeInTheDocument();
    expect(within(table).queryByText("BNSOL")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "yield" }));
    expect(within(table).getByText("sUSD")).toBeInTheDocument();
  });
});
