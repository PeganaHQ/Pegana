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

const NO_PACING = { spacingMs: 0, retryDelaysMs: [0, 0, 0], jitterMs: 0 };

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
      0,
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
        0,
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
    render(<ExitLiquidity asset={{ ...ASSET, state: "PEGGED" }} state="PEGGED" pacing={NO_PACING} />);
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
    render(<ExitLiquidity asset={{ ...ASSET, state: "PEGGED" }} state="PEGGED" pacing={NO_PACING} />);
    await waitFor(() => expect(screen.getAllByText("n/a").length).toBeGreaterThan(0), {
      timeout: 5000,
    });
    expect(screen.queryByTestId("exit-no-impact")).toBeNull();
    expect(screen.queryByText("<0.001%")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("keeps the chart when an impact is visible", async () => {
    stubQuotes("0.004");
    render(<ExitLiquidity asset={{ ...ASSET, state: "PEGGED" }} state="PEGGED" pacing={NO_PACING} />);
    await waitFor(() => expect(screen.getByText(/price-impact curve/i)).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(screen.queryByTestId("exit-no-impact")).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("quote pacing and backoff", () => {
  it("backs off 2s, 5s, 12s plus jitter", async () => {
    const { retryDelayMs, QUOTE_RETRY_DELAYS_MS } = await import(
      "@/components/organisms/exit-liquidity"
    );
    const pacing = { retryDelaysMs: QUOTE_RETRY_DELAYS_MS, jitterMs: 750 };
    expect(retryDelayMs(1, new Error("x"), pacing, () => 0)).toBe(2_000);
    expect(retryDelayMs(2, new Error("x"), pacing, () => 0)).toBe(5_000);
    expect(retryDelayMs(3, new Error("x"), pacing, () => 1)).toBe(12_750);
    expect(QUOTE_RETRY_DELAYS_MS).toHaveLength(3);
  });

  it("raises the wait to an upstream Retry-After, capped at 15s", async () => {
    const { retryDelayMs, QuoteError } = await import(
      "@/components/organisms/exit-liquidity"
    );
    const pacing = { retryDelaysMs: [2_000], jitterMs: 0 };
    expect(
      retryDelayMs(1, new QuoteError("rl", true, 9_000), pacing, () => 0),
    ).toBe(9_000);
    expect(
      retryDelayMs(1, new QuoteError("rl", true, 500), pacing, () => 0),
    ).toBe(2_000);
    expect(
      retryDelayMs(1, new QuoteError("rl", true, 600_000), pacing, () => 0),
    ).toBe(15_000);
  });

  it("parses Retry-After seconds and HTTP dates", async () => {
    const { parseRetryAfterMs } = await import(
      "@/components/organisms/exit-liquidity"
    );
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("3")).toBe(3_000);
    const now = Date.parse("2026-10-21T00:00:00Z");
    expect(parseRetryAfterMs("Wed, 21 Oct 2026 00:00:04 GMT", now)).toBe(4_000);
    expect(parseRetryAfterMs("soon")).toBeNull();
  });

  it("does not retry a non-retryable (4xx) quote error", async () => {
    const { quoteWithRetry, QuoteError } = await import(
      "@/components/organisms/exit-liquidity"
    );
    let n = 0;
    await expect(
      quoteWithRetry(
        async () => {
          n++;
          throw new QuoteError("Jupiter 400", false, null);
        },
        () => false,
        [0, 0, 0],
        0,
      ),
    ).rejects.toThrow("Jupiter 400");
    expect(n).toBe(1);
  });

  it("requests the rungs one at a time, spaced, and recovers a rate-limited rung", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const starts: number[] = [];
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls++;
        starts.push(Date.now());
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        const amount = Number(new URL(url, "http://x").searchParams.get("amount"));
        if (calls === 2) {
          return new Response(
            JSON.stringify({ error: "Quote unavailable", upstreamStatus: 429 }),
            { status: 503, headers: { "retry-after": "0" } },
          );
        }
        return new Response(
          JSON.stringify({
            outAmount: String(amount),
            priceImpactPct: "0.004",
            routePlan: [{ swapInfo: { label: "Orca" } }],
          }),
          { status: 200 },
        );
      }),
    );
    render(
      <ExitLiquidity
        asset={{ ...ASSET, state: "PEGGED" }}
        state="PEGGED"
        pacing={{ spacingMs: 40, retryDelaysMs: [0, 0, 0], jitterMs: 0 }}
      />,
    );
    await waitFor(
      () => expect(screen.getByText(/price-impact curve/i)).toBeInTheDocument(),
      { timeout: 5000 },
    );
    expect(screen.queryByText("Quote failed")).toBeNull();
    expect(maxInFlight).toBe(1);
    // Five rungs plus one retry; every start at least the spacing after the last.
    expect(starts).toHaveLength(6);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(35);
    }
    vi.unstubAllGlobals();
  });
});

describe("quoteErrorFrom", () => {
  const proxy503 = (upstreamStatus: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ error: "Quote unavailable", upstreamStatus }), {
      status: 503,
      headers,
    });

  it("does not retry an upstream 4xx such as a 400 'no route'", async () => {
    const { quoteErrorFrom } = await import("@/components/organisms/exit-liquidity");
    for (const us of [400, 404, 422]) {
      const e = await quoteErrorFrom(proxy503(us));
      expect(e.retryable).toBe(false);
    }
  });

  it("retries an upstream 429 with its Retry-After, and an upstream 5xx", async () => {
    const { quoteErrorFrom } = await import("@/components/organisms/exit-liquidity");
    const rl = await quoteErrorFrom(proxy503(429, { "retry-after": "4" }));
    expect(rl.retryable).toBe(true);
    expect(rl.retryAfterMs).toBe(4_000);
    expect((await quoteErrorFrom(proxy503(502))).retryable).toBe(true);
    // A network-level 503 without an upstream status stays retryable.
    expect((await quoteErrorFrom(new Response("x", { status: 503 }))).retryable).toBe(true);
  });

  it("an upstream 400 rung is asked once, not four times", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return proxy503(400);
      }),
    );
    render(
      <ExitLiquidity
        asset={{ ...ASSET, state: "PEGGED" }}
        state="PEGGED"
        pacing={NO_PACING}
      />,
    );
    // Each row renders twice (mobile card list + desktop table).
    await waitFor(() => expect(screen.queryAllByText("Fetching…")).toHaveLength(0), {
      timeout: 4000,
    });
    expect(screen.getAllByText("Quote failed")).toHaveLength(10);
    expect(calls).toBe(5);
    vi.unstubAllGlobals();
  });
});

describe("ExitLiquidity aborts its in-flight quote on unmount", () => {
  it("aborts the pending fetch", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return new Promise(() => {});
      }),
    );
    const { unmount } = render(
      <ExitLiquidity asset={{ ...ASSET, state: "PEGGED" }} state="PEGGED" pacing={NO_PACING} />,
    );
    await waitFor(() => expect(seen).toBeDefined());
    expect(seen!.aborted).toBe(false);
    unmount();
    expect(seen!.aborted).toBe(true);
    vi.unstubAllGlobals();
  });
});
