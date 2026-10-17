"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { useLoopExposure } from "@/lib/hooks/use-loop-exposure";
import type { AssetCardData } from "@/lib/api/types";

// Sub-C "Loop Intelligence" — advisory cross-protocol leverage exposure + a
// depeg-liquidation-cascade estimate. Reads /v1/assets/{symbol}/loop-exposure,
// which now carries the whole preset-shock cascade in one call. Everything here is
// a model estimate, clearly labelled — never a verifiable receipt (ADR-0036).
// Anonymous by construction: k-floored bands, no owner/authority ever read.

const PROTO_LABEL: Record<string, string> = {
  kamino: "Kamino",
  jupiter_lend: "Jupiter Lend",
};

function usdCompact(v?: string | number | null): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n === 0) return "$0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function shockLabel(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;
}

const BAR_MAX_PX = 96;

export function SystemicImpact({ asset }: { asset: AssetCardData }) {
  const { data: exp } = useLoopExposure(asset.symbol);

  const hasExposure = !!exp && Number(exp.loop_exposure_usd) > 0;

  // liquidatable_usd per shock rung — straight from /loop-exposure's cascade.
  const rungs = useMemo(
    () =>
      (exp?.cascade ?? []).map((r) => ({
        bps: r.shock_bps,
        liq: Number(r.liquidatable_usd) || 0,
        positions: r.positions,
      })),
    [exp],
  );
  const maxLiq = useMemo(
    () => rungs.reduce((m, r) => Math.max(m, r.liq), 0),
    [rungs],
  );
  const deepest = rungs.length ? rungs[rungs.length - 1].bps : 2000;

  // Default selection: the smallest shock that liquidates anything ("first
  // blood") so the detail reads a real number; else the deepest rung.
  const firstBloodIdx = rungs.findIndex((r) => r.liq > 0);
  const [selIdx, setSelIdx] = useState<number | null>(null);
  const activeIdx =
    selIdx != null
      ? selIdx
      : firstBloodIdx >= 0
        ? firstBloodIdx
        : rungs.length - 1;
  const sel = rungs[activeIdx];

  const protocols = exp?.by_protocol
    .map((p) => PROTO_LABEL[p.protocol] ?? p.protocol)
    .join(" + ");

  return (
    <section className="rounded-[16px] border border-hairline bg-surface-1 p-5 sm:p-6">
      <header className="mb-1.5 flex items-baseline justify-between gap-3">
        <h3 className="text-[17px] font-medium tracking-[-0.01em]">
          Loop impact
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
          advisory · not a receipt
        </span>
      </header>
      <p className="mb-5 max-w-[54ch] text-[12px] leading-relaxed text-text-muted">
        Leverage stacked on {asset.symbol} across Solana lending markets, and
        how much of it would cross a liquidation threshold if {asset.symbol}{" "}
        depegs. The cross-protocol cascade no single lending dashboard shows.
      </p>

      {!exp ? (
        <div>
          <span className="sr-only">Loading leverage exposure</span>
          <div className="animate-pulse space-y-3" aria-hidden>
            <div className="h-4 w-3/4 rounded-full bg-surface-2" />
            <div className="h-4 w-1/2 rounded-full bg-surface-2" />
            <div className="h-4 w-2/3 rounded-full bg-surface-2" />
          </div>
        </div>
      ) : !hasExposure ? (
        <div>
          <p className="text-[13px] text-text-muted">
            No leveraged positions are tracked on {asset.symbol} across Kamino or
            Jupiter Lend right now; negligible cross-protocol cascade risk.
          </p>
          <Link
            href="/systemic"
            className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted transition-colors hover:text-text"
          >
            Explore the cross-protocol cascade simulator <span aria-hidden>→</span>
          </Link>
        </div>
      ) : (
        <>
          {/* Total exposure */}
          <div className="mb-4">
            <div className="font-mono text-[28px] leading-none tracking-[-0.02em] tabular-nums">
              {usdCompact(exp.loop_exposure_usd)}
            </div>
            <p className="mt-1.5 text-[12px] text-text-muted">
              leveraged collateral stacked on {asset.symbol} across {protocols}
            </p>
          </div>

          {/* Per-protocol split */}
          <ul className="mb-6 grid gap-1.5 sm:grid-cols-2">
            {exp.by_protocol.map((p) => (
              <li
                key={p.protocol}
                className="flex items-baseline justify-between gap-2 rounded-[10px] border border-hairline-soft px-3 py-2"
              >
                <span className="text-[13px]">
                  {PROTO_LABEL[p.protocol] ?? p.protocol}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-text-muted">
                  {usdCompact(p.collateral_lev_usd)} lev ·{" "}
                  {usdCompact(p.debt_usd)} debt
                </span>
              </li>
            ))}
          </ul>

          {/* Stress ladder — the cascade escalating with depeg depth. */}
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
            Liquidation cascade: if {asset.symbol} depegs by…
          </div>

          {maxLiq === 0 ? (
            <div className="rounded-[14px] border border-hairline-soft p-4 text-[12px] text-text-muted">
              No tracked positions cross their liquidation threshold even at a{" "}
              {shockLabel(deepest)} depeg; the leverage on {asset.symbol} is
              deeply collateralised.
            </div>
          ) : (
            <>
              <div
                className="flex items-end gap-2 sm:gap-3"
                style={{ height: BAR_MAX_PX + 16 }}
              >
                {rungs.map((r, i) => {
                  const h =
                    r.liq > 0
                      ? Math.max(3, Math.round((r.liq / maxLiq) * BAR_MAX_PX))
                      : 2;
                  const active = i === activeIdx;
                  return (
                    <button
                      key={r.bps}
                      type="button"
                      onClick={() => setSelIdx(i)}
                      className="group flex flex-1 flex-col items-center justify-end gap-1.5"
                      aria-label={`${shockLabel(r.bps)} depeg, ${usdCompact(r.liq)} liquidatable`}
                    >
                      <span
                        className={cn(
                          "font-mono text-[10px] tabular-nums transition-[color]",
                          active
                            ? "text-st-depeg-text"
                            : "text-text-muted group-hover:text-text",
                        )}
                      >
                        {r.liq > 0 ? usdCompact(r.liq) : "-"}
                      </span>
                      <span
                        className={cn(
                          "w-full rounded-[4px] transition-[background-color]",
                          active
                            ? "bg-st-depeg"
                            : "bg-st-depeg/25 group-hover:bg-st-depeg/45",
                        )}
                        style={{ height: h }}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="mt-1.5 flex gap-2 sm:gap-3">
                {rungs.map((r, i) => (
                  <button
                    key={r.bps}
                    type="button"
                    onClick={() => setSelIdx(i)}
                    className={cn(
                      "flex-1 font-mono text-[11px] tabular-nums transition-[color]",
                      i === activeIdx
                        ? "text-text"
                        : "text-text-muted hover:text-text",
                    )}
                  >
                    {shockLabel(r.bps)}
                  </button>
                ))}
              </div>

              {/* Selected-rung detail — a plain block, not a nested card */}
              {sel && (
                <div className="mt-5 border-t border-hairline-soft pt-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
                    At a {shockLabel(sel.bps)} depeg
                  </div>
                  <div className="mt-1 font-mono text-[22px] leading-none tracking-[-0.02em] tabular-nums text-st-depeg-text">
                    {sel.liq > 0 ? usdCompact(sel.liq) : "$0"}
                  </div>
                  <p className="mt-1.5 text-[12px] text-text-muted">
                    {sel.liq > 0 ? (
                      <>
                        of leveraged collateral crosses its liquidation
                        threshold; {sel.positions} positions · coverage:{" "}
                        {exp.coverage}
                      </>
                    ) : (
                      <>no tracked positions liquidate at this depth</>
                    )}
                  </p>
                </div>
              )}
            </>
          )}

          <p className="mt-4 text-[11px] leading-relaxed text-text-muted">
            {exp.advisory_note}
          </p>
          {/* Honest-floor footnote: what `coverage` means + how many venues are
              tracked so far, so the number reads as a floor, never a ceiling. */}
          <p className="mt-2 text-[11px] leading-relaxed text-text-caption">
            <span className="font-mono uppercase tracking-[0.06em]">
              coverage {exp.coverage}
            </span>            {" "}
            Risky bands may be k-anonymity–suppressed, and only{" "}
            <strong className="font-medium text-text-muted">
              2 of ~6 Solana lending venues
            </strong>{" "}
            are tracked so far (Kamino, Jupiter Lend). Read this as an honest
            floor, not a ceiling.
          </p>
        </>
      )}
    </section>
  );
}
