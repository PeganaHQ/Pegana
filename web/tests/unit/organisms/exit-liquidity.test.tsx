import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ExitLiquidity } from "@/components/organisms/exit-liquidity";
import type { AssetCardData } from "@/lib/api/types";

// ExitLiquidity calls fetch (Jupiter quotes) and matchMedia (mobile detection).
// Both are irrelevant for the UNKNOWN gate test — we just need the guard to
// fire before any of that runs.
vi.mock("node-fetch", () => ({}));

const ASSET: AssetCardData = {
  symbol: "sHYUSD",
  name: "Staked Hylo USD",
  mint: "HYUSDmint1111111111111111111111111111111111",
  class: "stable_yield",
  peg_target: "USD",
  decimals: 6,
  state: "UNKNOWN",
  discount: "0.1690",
  intrinsic_usd: "1.2011",
  market_usd: "1.0000",
  risk_score: null,
  market_cap: null,
  circulating_supply: null,
  liquidity_usd: null,
  volume_24h_usd: null,
  holder_count: null,
  market_context_at: null,
  updated_at: new Date().toISOString(),
};

describe("ExitLiquidity — UNKNOWN gate", () => {
  it("does NOT show the quote table when state is UNKNOWN", () => {
    render(<ExitLiquidity asset={ASSET} state="UNKNOWN" />);
    // The confident "Safe to exit" copy must be absent.
    expect(screen.queryByText(/safe to exit/i)).toBeNull();
    // The slippage table headers must be absent.
    expect(screen.queryByText(/slippage by size/i)).not.toHaveTextContent?.(
      "Live Jupiter",
    );
    // An honest "insufficient signal" message should appear instead.
    expect(screen.getByText(/insufficient signal/i)).toBeInTheDocument();
  });

  it("shows the heading and neutral note (not quote rows) when state is UNKNOWN", () => {
    render(<ExitLiquidity asset={ASSET} state="UNKNOWN" />);
    expect(screen.getByText("Exit liquidity")).toBeInTheDocument();
    // Neutral placeholder must mention why quotes are hidden.
    // Note: the component uses a typographic apostrophe (’) — match broadly.
    expect(screen.getByText(/exit quotes are hidden/i)).toBeInTheDocument();
  });

  it("DOES render the quote table section when state is PEGGED", () => {
    render(
      <ExitLiquidity asset={{ ...ASSET, state: "PEGGED" }} state="PEGGED" />,
    );
    // The table renders with loading skeletons — "Fetching…" or column headers.
    // The "insufficient signal" note must NOT appear.
    expect(screen.queryByText(/insufficient signal/i)).toBeNull();
    // Size column header is present in the full table.
    expect(
      screen.getAllByText(/size|fetching|quote failed/i).length,
    ).toBeGreaterThan(0);
  });

  it("DOES render normally when no state prop is passed (backward compat)", () => {
    render(<ExitLiquidity asset={{ ...ASSET, state: "PEGGED" }} />);
    expect(screen.queryByText(/insufficient signal/i)).toBeNull();
  });
});

describe("parseImpactPct", () => {
  it("treats missing, empty and non-numeric values as unknown", async () => {
    const { parseImpactPct } = await import("@/components/organisms/exit-liquidity");
    expect(parseImpactPct(undefined)).toBeNull();
    expect(parseImpactPct("")).toBeNull();
    expect(parseImpactPct("abc")).toBeNull();
    expect(parseImpactPct("0")).toBe(0);
    expect(parseImpactPct("0.004")).toBeCloseTo(0.4);
  });
});

describe("quoteWithRetry", () => {
  it("retries a failed quote and returns the first success", async () => {
    const { quoteWithRetry } = await import(
      "@/components/organisms/exit-liquidity"
    );
    let n = 0;
    const out = await quoteWithRetry(
      async () => {
        n++;
        if (n < 3) throw new Error("Quote unavailable");
        return "ok";
      },
      () => false,
      [0, 0],
    );
    expect(out).toBe("ok");
    expect(n).toBe(3);
  });

  it("gives up after the bounded retries", async () => {
    const { quoteWithRetry } = await import(
      "@/components/organisms/exit-liquidity"
    );
    let n = 0;
    await expect(
      quoteWithRetry(
        async () => {
          n++;
          throw new Error("429");
        },
        () => false,
        [0, 0],
      ),
    ).rejects.toThrow("429");
    expect(n).toBe(3);
  });
});

describe("ExitLiquidity flat curve", () => {
  const stubQuotes = (priceImpactPct: string) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const amount = Number(new URL(url, "http://x").searchParams.get("amount"));
        return {
          ok: true,
          json: async () => ({
            outAmount: String(amount),
            priceImpactPct,
            routePlan: [{ swapInfo: { label: "Orca" } }],
          }),
        };
      }),
    );
  };

  it("shows a compact 'no measurable price impact' line instead of the chart", async () => {
    stubQuotes("0");
    render(<ExitLiquidity asset={{ ...ASSET, state: "PEGGED" }} state="PEGGED" />);
    const note = await screen.findByTestId("exit-no-impact", {}, { timeout: 5000 });
    expect(note).toHaveTextContent("No measurable price impact up to $1M");
    expect(screen.queryByText(/price-impact curve/i)).toBeNull();
    // The table stays.
    expect(screen.getByRole("table")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it.each([
    ["missing", undefined],
    ["empty string", ""],
    ["garbled", "abc"],
  ])("does not claim 'no impact' when priceImpactPct is %s", async (_n, v) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const amount = Number(new URL(url, "http://x").searchParams.get("amount"));
        return {
          ok: true,
          json: async () => ({
            outAmount: String(amount),
            ...(v === undefined ? {} : { priceImpactPct: v }),
            routePlan: [{ swapInfo: { label: "Orca" } }],
          }),
        };
      }),
    );
    render(<ExitLiquidity asset={{ ...ASSET, state: "PEGGED" }} state="PEGGED" />);
    await waitFor(() => expect(screen.getAllByText("n/a").length).toBeGreaterThan(0), {
      timeout: 5000,
    });
    expect(screen.queryByTestId("exit-no-impact")).toBeNull();
    expect(screen.queryByText("<0.001%")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("keeps the chart when an impact is visible", async () => {
    stubQuotes("0.004");
    render(<ExitLiquidity asset={{ ...ASSET, state: "PEGGED" }} state="PEGGED" />);
    await waitFor(() => expect(screen.getByText(/price-impact curve/i)).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(screen.queryByTestId("exit-no-impact")).toBeNull();
    vi.unstubAllGlobals();
  });
});
