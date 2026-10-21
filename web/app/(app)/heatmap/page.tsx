"use client";

import { useMemo } from "react";
import Link from "@/components/atoms/intent-link";
import { useAssets } from "@/lib/hooks/use-assets";
import { holderSignedPct, reconcileBps } from "@/lib/api/format";
import { stateMeta } from "@/lib/asset/state-meta";
import { spreadSignVar } from "@/lib/state-class";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { AssetCardData, PegState } from "@/lib/api/types";
import { TokenIcon } from "@/components/atoms/token-icon";

// /heatmap — a visual treemap-style risk heatmap where each asset is a cell
// colored by its peg state, sized by its risk score. The grid gives an
// instant gestalt read: are we in a calm market (all green) or a stressed
// one (scattered coral)? This is the "standing back and squinting" surface
// that the dashboard b-line board — sorted, paginated, columnar — can't
// provide because its job is precision, not pattern recognition.

const STATE_ORDER: Array<PegState> = [
  "BLACK_SWAN",
  "CRITICAL",
  "DEPEG",
  "DRIFT",
  "PEGGED",
  "UNKNOWN",
];

function sortFn(a: AssetCardData, b: AssetCardData): number {
  const ai = STATE_ORDER.indexOf(a.state ?? "UNKNOWN");
  const bi = STATE_ORDER.indexOf(b.state ?? "UNKNOWN");
  if (ai !== bi) return ai - bi;
  // Within same state, higher risk score first
  return (b.risk_score ?? 0) - (a.risk_score ?? 0);
}

export default function HeatmapPage() {
  const { data: assets, isLoading, error } = useAssets();

  const cells = useMemo(() => {
    if (!assets) return [];
    return assets
      .filter((a) => !a.symbol.startsWith("_deprecated_"))
      .sort(sortFn)
      .map((a) => {
        const { bps } = reconcileBps(a);
        const m = stateMeta(a.state);
        return { asset: a, bps, meta: m };
      });
  }, [assets]);

  // Count per state for the summary strip
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const cell of cells) {
      c[cell.asset.state ?? "UNKNOWN"] = (c[cell.asset.state ?? "UNKNOWN"] ?? 0) + 1;
    }
    return c;
  }, [cells]);

  return (
    <main className="mx-auto max-w-[1240px] px-5 pt-6 sm:px-8 sm:pt-8 lg:px-10 lg:pb-24">
      <header className="mb-8 sm:mb-10">
        <span className="mb-3 inline-flex rounded-full border border-hairline px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-text-caption">
          Heatmap
        </span>
        <h1 className="text-balance text-[26px] font-medium leading-[1.1] tracking-[-0.02em] text-text sm:text-[34px]">
          One glance. Every peg at once.
        </h1>
        <p className="mt-3 max-w-[62ch] text-[14px] leading-[1.6] text-text-body sm:text-[15px]">
          Each cell is one tracked asset, colored by its committed peg state.
          Sizing by risk score. A green grid is a calm market; coral cells mean
          stress. Click any cell for the full asset detail.
        </p>
      </header>

      {/* Summary strip — state counts as inline pills */}
      <div className="mb-8 flex flex-wrap gap-3">
        {(["PEGGED", "DRIFT", "DEPEG", "CRITICAL", "BLACK_SWAN", "UNKNOWN"] as PegState[]).map(
          (s) => {
            const m = stateMeta(s);
            const count = counts[s] ?? 0;
            if (count === 0 && s !== "PEGGED") return null;
            return (
              <div
                key={s}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em]",
                  m.badgeClass,
                )}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: m.dotVar }}
                />
                {m.label}
                <span className="tabular-nums opacity-70">{count}</span>
              </div>
            );
          },
        )}
      </div>

      {isLoading && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {Array.from({ length: 48 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square animate-pulse rounded-[8px] border border-hairline bg-text/[0.03]"
            />
          ))}
        </div>
      )}

      {error && !assets && (
        <div className="rounded-[16px] border border-hairline bg-surface-1 px-6 py-16 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-st-drift">
            ● Live feed unreachable
          </p>
          <p className="mt-3 text-[14px] text-text-muted">
            The heatmap will appear when the feed is healthy.
          </p>
          <div className="mt-4 flex items-center justify-center gap-4 text-[12px]">
            <Link href="/heatmap" className="font-mono uppercase tracking-[0.08em] underline decoration-dotted underline-offset-2 hover:text-text">
              Retry
            </Link>
            <span className="text-text-caption">·</span>
            <Link href="/status" className="font-mono uppercase tracking-[0.08em] underline decoration-dotted underline-offset-2 hover:text-text">
              System status
            </Link>
          </div>
        </div>
      )}

      {!isLoading && !error && cells.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          {cells.map(({ asset, meta, bps }) => {
            const score = asset.risk_score ?? 0;
            // Cells are minimum 56px, and grow up to 2fr based on risk score
            // (higher score = bigger cell = more visually prominent). Calm
            // assets (score 0) still occupy one cell — they're visible, not
            // hidden, just compact.
            const spanClass =
              score >= 75
                ? "col-span-2 row-span-2"
                : score >= 50
                  ? "col-span-2"
                  : "";
            return (
              <Link
                key={asset.symbol}
                href={`/asset/${encodeURIComponent(asset.symbol)}`}
                className={cn(
                  "group relative flex flex-col items-center justify-center overflow-hidden rounded-[10px] border p-2 transition-[transform,box-shadow] duration-300 hover:z-10 hover:scale-[1.05] hover:shadow-[0_4px_24px_rgba(0,0,0,.3)]",
                  spanClass,
                  // No colour classes here at all. The `style` below sets
                  // backgroundColor and borderColor unconditionally via
                  // color-mix(), and an inline style beats a utility class — so
                  // any class branch on this element is dead code that reads as
                  // if it does something. (It replaced a runtime-built
                  // `border-[${...}]`, which Tailwind's scanner never saw.)
                )}
                style={{
                  backgroundColor: `color-mix(in srgb, ${meta.dotVar} 10%, transparent)`,
                  borderColor: `color-mix(in srgb, ${meta.dotVar} 30%, var(--color-hairline))`,
                }}
                title={`${displaySymbol(asset.symbol)}. ${meta.label} (risk ${score})`}
              >
                <TokenIcon
                  mint={asset.mint}
                  symbol={displaySymbol(asset.symbol)}
                  klass={asset.class}
                  size={score >= 75 ? 28 : 20}
                />
                <span
                  className="mt-1 font-mono text-[10px] font-medium text-text"
                  style={{ fontSize: score >= 50 ? "12px" : "11px" }}
                >
                  {displaySymbol(asset.symbol)}
                </span>
                {bps != null && (
                  <span
                    className="font-mono text-[8px] tabular-nums"
                    // The CELL draws the state (tint + border); this number
                    // takes its own sign, same split as the /events day-group
                    // and the compare legend. It used to borrow `meta.dotVar`.
                    style={{
                      color: spreadSignVar(bps),
                      fontSize: score >= 50 ? "11px" : "10px",
                    }}
                  >
                    {/* Was a local `(bps > 0 ? "-" : "+") + toFixed(2)`: an
                        ASCII hyphen where the rest of the site prints U+2212,
                        and no "%" at all — which is why a DOM sweep for signed
                        percentages found zero numbers on this page and missed
                        the surface entirely. */}
                    {holderSignedPct(bps)}
                  </span>
                )}
                {/* Risk score number for prominent cells */}
                {score >= 50 && (
                  <span
                    className="absolute right-1 top-1 font-mono text-[8px] tabular-nums opacity-60"
                    style={{ color: meta.dotVar }}
                  >
                    {score}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
