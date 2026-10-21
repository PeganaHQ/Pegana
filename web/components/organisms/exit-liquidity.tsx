"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils/cn";
import type { AssetCardData, PegState } from "@/lib/api/types";
import { Sparkline } from "@/components/atoms/sparkline";
import {
  fmtSize,
  fmtUsd,
  impactColor,
  noMeasurableImpactUpTo,
  nextQuotePrice,
  quoteAmountBaseUnits,
  scaleOutToRequestedSize,
  safeExitSize,
} from "@/lib/asset/exit-liquidity";
import { displaySymbol } from "@/lib/asset/display-symbol";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SIZES_USD = [1_000, 10_000, 50_000, 250_000, 1_000_000] as const;
// Mobile reflow: a single representative $10k quote instead of blanking the
// page's most differentiated feature behind three "Quote failed" rows. Keeps
// the lite-api request budget to one call on a phone.
const MOBILE_SIZES = [10_000] as const;

// Size-ladder board — the SAME approved <table>/<colgroup> mechanic as the
// universe screener (see assets-screener-row.tsx's header comment for the
// full rationale): real <table table-fixed>, an explicit <colgroup> pinning
// every column width ONCE, and th/td padding mirrored from ONE shared map
// (EXIT_COL_PAD) so the header labels and their columns' cells can never
// drift out of alignment. Same V5 card chrome too (surface-1, r20, header
// band bg-surface-2/60, hairline divide).
//
// The mobile variant is a separate sibling card list (sm:hidden), never a
// card smuggled inside the desktop <table>'s colSpan cell — a table-fixed
// table's <colgroup> pins the table to its fixed column widths at every
// viewport, so a mobile card forced through a colSpan cell scrolls sideways
// with its right half off-screen (the exact regression the dashboard board
// already fixed once; see assets-screener-row.tsx).
const EXIT_COL_PAD = {
  size: "pl-5 pr-3",
  route: "px-4",
  usdc: "px-4",
  impact: "pr-5",
} as const;

const HEADER_CELL =
  "py-3 font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption";

interface QuoteRow {
  sizeUsd: number;
  usdcOut: number | null;
  impactPct: number | null;
  routeLabel: string | null;
  loading: boolean;
  failed: boolean;
}

/** Jupiter's priceImpactPct (a fraction string) as percent; null if unusable. */
export function parseImpactPct(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = Number(raw) * 100;
  return Number.isFinite(n) ? n : null;
}

async function jupiterQuote(
  inputMint: string,
  decimals: number,
  marketUsd: number,
  sizeUsd: number,
): Promise<{ usdcOut: number; impactPct: number | null; routeLabel: string | null }> {
  const inputAmount = quoteAmountBaseUnits(sizeUsd, marketUsd, decimals);
  const url =
    `/api/jupiter-quote` +
    `?inputMint=${inputMint}` +
    `&outputMint=${USDC_MINT}` +
    `&amount=${inputAmount}` +
    `&slippageBps=50`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Jupiter ${res.status}`);
  const d = await res.json();
  if (d.error) throw new Error(d.error);
  const labels = [
    ...new Set<string>(
      (d.routePlan ?? [])
        .map((r: { swapInfo?: { label?: string } }) => r.swapInfo?.label)
        .filter(
          (l: unknown): l is string => typeof l === "string" && l.length > 0,
        ),
    ),
  ];
  // outAmount is for the rounded input; rescale it to the size the row shows.
  const usdcOut = scaleOutToRequestedSize(
    Number(d.outAmount) / 1e6,
    inputAmount,
    sizeUsd,
    marketUsd,
    decimals,
  );
  if (usdcOut == null) throw new Error("Jupiter quote has no usable amount");
  return {
    usdcOut,
    // A missing or garbled impact is UNKNOWN (null), never 0: 0 would read as
    // "no price impact".
    impactPct: parseImpactPct(d.priceImpactPct),
    routeLabel: labels.join(" → ") || null,
  };
}

// Jupiter rate-limits bursts: firing all five sizes at once failed 27 of 40
// quotes in a live probe (every failure an upstream 429), while one-at-a-time
// requests succeed. So the ladder is fetched sequentially, and a failed size is
// retried with backoff before it is shown as "Quote failed".
const QUOTE_RETRY_DELAYS_MS = [1_500, 4_000] as const;

function sleep(ms: number, isCancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (isCancelled()) return resolve();
    setTimeout(resolve, ms);
  });
}

/** One quote with bounded retries. Exported for tests. */
export async function quoteWithRetry<T>(
  fetchOnce: () => Promise<T>,
  isCancelled: () => boolean,
  delays: readonly number[] = QUOTE_RETRY_DELAYS_MS,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1], isCancelled);
    if (isCancelled()) break;
    try {
      return await fetchOnce();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("cancelled");
}

function makeLoadingRows(sizes: readonly number[]): QuoteRow[] {
  return sizes.map((s) => ({
    sizeUsd: s,
    usdcOut: null,
    impactPct: null,
    routeLabel: null,
    loading: true,
    failed: false,
  }));
}

export function ExitLiquidity({
  asset,
  state,
}: {
  asset: AssetCardData;
  state?: PegState;
}) {
  // Engine has no trustworthy signal — telling the user "safe to exit up to $X"
  // on an UNKNOWN asset is actively misleading. Suppress the whole widget.
  if (state === "UNKNOWN") {
    return (
      <div>
        <h2 className="text-[28px] font-medium leading-[1.1] tracking-[-0.01em] text-text">
          Exit liquidity
        </h2>
        <p className="mb-6 mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
          Redeem {displaySymbol(asset.symbol)} → USDC right now · slippage by
          size
        </p>
        <div className="rounded-[20px] border border-hairline bg-surface-1 px-5 py-6 font-mono text-[12px] text-text-muted">
          Insufficient signal; the engine can&rsquo;t classify this asset right
          now. Exit quotes are hidden until the state resolves.
        </div>
      </div>
    );
  }
  // All the hooks live in the inner so a mid-session flip to UNKNOWN unmounts
  // it cleanly — early-returning above the useState/useEffect/useMemo below is
  // a Rules-of-Hooks crash (and would also fire Jupiter quotes for an asset we
  // can't classify).
  return <ExitLiquidityInner asset={asset} />;
}

function ExitLiquidityInner({ asset }: { asset: AssetCardData }) {
  const marketUsd = asset.market_usd ? parseFloat(asset.market_usd) : null;
  const isUsdc = asset.mint === USDC_MINT;

  // On a phone, sample a single representative size; on desktop, the full ladder.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const sizes = useMemo<readonly number[]>(
    () => (isMobile ? MOBILE_SIZES : SIZES_USD),
    [isMobile],
  );

  const [rows, setRows] = useState<QuoteRow[]>(() =>
    makeLoadingRows(SIZES_USD),
  );

  // Re-quote only on a real (>=1%) market move, not on every 30s poll.
  const [quotePrice, setQuotePrice] = useState<number | null>(() =>
    nextQuotePrice(null, marketUsd),
  );
  useEffect(() => {
    setQuotePrice((cur) => nextQuotePrice(cur, marketUsd));
  }, [marketUsd]);

  useEffect(() => {
    if (isUsdc || !quotePrice || quotePrice <= 0) return;
    const marketUsd = quotePrice;

    let cancelled = false;
    const isCancelled = () => cancelled;
    setRows(makeLoadingRows(sizes));

    // Sequential, not Promise.all: see QUOTE_RETRY_DELAYS_MS.
    void (async () => {
      for (const [i, sizeUsd] of sizes.entries()) {
        if (cancelled) return;
        try {
          const result = await quoteWithRetry(
            () =>
              jupiterQuote(asset.mint, asset.decimals, marketUsd, sizeUsd),
            isCancelled,
          );
          if (!cancelled) {
            setRows((prev) => {
              const next = [...prev];
              next[i] = { sizeUsd, ...result, loading: false, failed: false };
              return next;
            });
          }
        } catch {
          if (!cancelled) {
            setRows((prev) => {
              const next = [...prev];
              if (next[i])
                next[i] = { ...next[i], loading: false, failed: true };
              return next;
            });
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [asset.mint, asset.decimals, quotePrice, isUsdc, sizes]);

  // Depth-curve summary (desktop, once the whole ladder is sampled): the largest
  // exit size still under the 0.3% depeg-tier slippage line.
  const fullyLoaded =
    !isMobile &&
    rows.length > 1 &&
    rows.every((r) => !r.loading && !r.failed && r.impactPct != null);
  const safeSize = useMemo(
    () =>
      safeExitSize(
        rows.map((r) => ({ sizeUsd: r.sizeUsd, impactPct: r.impactPct })),
      ),
    [rows],
  );

  // Every sampled size rounds to "<0.001%": the curve is a flat line, so a
  // full-height chart would be an empty box. Say it in one compact line.
  const flatUpTo = useMemo(
    () =>
      fullyLoaded
        ? noMeasurableImpactUpTo(
            rows.map((r) => ({ sizeUsd: r.sizeUsd, impactPct: r.impactPct })),
          )
        : null,
    [fullyLoaded, rows],
  );

  return (
    <div>
      <h2 className="text-[28px] font-medium leading-[1.1] tracking-[-0.01em] text-text">
        Exit liquidity
      </h2>
      <p className="mb-6 mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
        Redeem {displaySymbol(asset.symbol)} → USDC right now · slippage by size
      </p>

      {flatUpTo != null && (
        <div
          data-testid="exit-no-impact"
          className="mb-3 hidden rounded-[16px] border border-hairline bg-surface-1 px-5 py-3 font-mono text-[11px] text-st-pegged sm:block"
        >
          No measurable price impact up to {fmtSize(flatUpTo)}
        </div>
      )}

      {fullyLoaded && flatUpTo == null && (
        <div className="mb-3 hidden rounded-[16px] border border-hairline bg-surface-1 px-5 py-4 sm:block">
          <div className="mb-2.5 flex items-baseline justify-between gap-3">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-caption">
              Price-impact curve · $1k → $1M
            </span>
            {safeSize != null ? (
              <span className="font-mono text-[11px] text-st-pegged">
                Safe to exit up to {fmtSize(safeSize)}
              </span>
            ) : (
              <span className="font-mono text-[11px] text-st-depeg-text">
                ≥0.3% impact at every sampled size
              </span>
            )}
          </div>
          <Sparkline
            points={rows.map((r) => r.impactPct ?? 0)}
            stroke="var(--color-st-drift)"
            showFill
            height={48}
          />
        </div>
      )}

      {isUsdc ? (
        <div className="rounded-[20px] border border-hairline bg-surface-1 px-5 py-6 font-mono text-[12px] text-text-muted">
          {displaySymbol(asset.symbol)} is USDC; no swap needed.
        </div>
      ) : !marketUsd ? (
        <div className="rounded-[20px] border border-hairline bg-surface-1 px-5 py-6 font-mono text-[12px] text-text-muted">
          Price unavailable; quotes cannot be fetched.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-hairline bg-surface-1">
          {/* Mobile — a separate sibling card list, never inside the desktop
              table's colSpan cell (see this file's header comment). */}
          <div className="divide-y divide-hairline sm:hidden">
            {rows.map((row) => (
              <div
                key={row.sizeUsd}
                className="flex flex-col gap-2 px-5 py-3.5"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-caption">
                    Exit size
                  </span>
                  <span className="font-mono text-[13px] font-medium tabular-nums text-text">
                    {fmtSize(row.sizeUsd)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-caption">
                    Route
                  </span>
                  <span className="truncate text-right font-mono text-[11px] text-text-muted">
                    {row.loading ? (
                      <span className="animate-pulse">Fetching…</span>
                    ) : row.failed ? (
                      <span className="text-text-muted">Quote failed</span>
                    ) : (
                           (row.routeLabel ?? "-")
                    )}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-caption">
                    USDC received
                  </span>
                  <span className="text-right font-mono text-[13px] tabular-nums text-text">
                    {row.loading ? (
                      <span className="animate-pulse text-text-muted">-</span>
                    ) : row.failed || row.usdcOut == null ? (
                      <span className="text-text-muted">-</span>
                    ) : (
                      fmtUsd(row.usdcOut)
                    )}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-caption">
                    Impact
                  </span>
                  <span
                    className={cn(
                      "text-right font-mono text-[13px] tabular-nums",
                      row.loading || row.failed || row.impactPct == null
                        ? "text-text-muted"
                        : impactColor(row.impactPct),
                    )}
                  >
                    {row.loading ? (
                      <span className="animate-pulse">-</span>
                    ) : row.failed ? (
                      "-"
                    ) : row.impactPct == null ? (
                      "n/a"
                    ) : (
                      `${row.impactPct < 0.001 ? "<0.001" : row.impactPct.toFixed(3)}%`
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop — real <table table-fixed> + <colgroup>, hidden below sm. */}
          <div className="hidden overflow-x-auto sm:block">
            <table
              aria-label="Exit-size ladder, live Jupiter quotes"
              className="w-full table-fixed border-collapse text-left"
            >
              <colgroup>
                <col className="w-[88px]" />
                <col />
                <col className="w-[140px]" />
                <col className="w-[100px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-hairline bg-surface-2/60">
                  <th
                    scope="col"
                    className={cn(HEADER_CELL, EXIT_COL_PAD.size)}
                  >
                    Size
                  </th>
                  <th
                    scope="col"
                    className={cn(HEADER_CELL, EXIT_COL_PAD.route)}
                  >
                    Best route
                  </th>
                  <th
                    scope="col"
                    className={cn(HEADER_CELL, "text-right", EXIT_COL_PAD.usdc)}
                  >
                    USDC received
                  </th>
                  <th
                    scope="col"
                    className={cn(
                      HEADER_CELL,
                      "text-right",
                      EXIT_COL_PAD.impact,
                    )}
                  >
                    Impact
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((row) => (
                  <tr key={row.sizeUsd} className="h-16">
                    <td
                      className={cn(
                        "h-16 py-0 align-middle",
                        EXIT_COL_PAD.size,
                      )}
                    >
                      <span className="font-mono text-[13px] font-medium tabular-nums text-text">
                        {fmtSize(row.sizeUsd)}
                      </span>
                    </td>
                    <td
                      className={cn(
                        "h-16 py-0 align-middle",
                        EXIT_COL_PAD.route,
                      )}
                    >
                      <span className="block truncate font-mono text-[12px] text-text-muted">
                        {row.loading ? (
                          <span className="animate-pulse">Fetching…</span>
                        ) : row.failed ? (
                          <span className="text-text-muted">Quote failed</span>
                        ) : (
                      (row.routeLabel ?? "-")
                        )}
                      </span>
                    </td>
                    <td
                      className={cn(
                        "h-16 py-0 align-middle text-right",
                        EXIT_COL_PAD.usdc,
                      )}
                    >
                      <span className="font-mono text-[13px] tabular-nums text-text">
                        {row.loading ? (
                          <span className="animate-pulse text-text-muted">
                            -
                          </span>
                        ) : row.failed || row.usdcOut == null ? (
                          <span className="text-text-muted">-</span>
                        ) : (
                          fmtUsd(row.usdcOut)
                        )}
                      </span>
                    </td>
                    <td
                      className={cn(
                        "h-16 py-0 align-middle text-right",
                        EXIT_COL_PAD.impact,
                      )}
                    >
                      <span
                        className={cn(
                          "font-mono text-[13px] tabular-nums",
                          row.loading || row.failed || row.impactPct == null
                            ? "text-text-muted"
                            : impactColor(row.impactPct),
                        )}
                      >
                        {row.loading ? (
                          <span className="animate-pulse">-</span>
                        ) : row.failed ? (
                          "-"
                        ) : row.impactPct == null ? (
                          "n/a"
                        ) : (
                          `${row.impactPct < 0.001 ? "<0.001" : row.impactPct.toFixed(3)}%`
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-3 font-mono text-[10px] leading-relaxed text-text-caption">
        Live Jupiter quotes · 50 bps slippage tolerance ·{" "}
        {isMobile
          ? "single representative size on mobile"
          : "not financial advice"}
      </p>
    </div>
  );
}
