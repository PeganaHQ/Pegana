"use client";

import Link from "@/components/atoms/intent-link";
import { VerdictChip } from "@/components/molecules/verdict-chip";
import { VerdictStat } from "@/components/molecules/verdict-stat";
import { verdictHeadline } from "@/lib/asset/digest";
import type {
  VerdictCounts,
  ClosestToBand,
  LastTransition,
} from "@/lib/asset/digest";
import { stateMeta } from "@/lib/asset/state-meta";
import { formatBandAwayPct } from "@/lib/api/format";
import { relativeStamp } from "@/lib/asset/relative-stamp";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { PegState } from "@/lib/api/types";

// The Command Center's signature (MASTER LEIS NOVAS #2): a worst-first VERDICT
// with a replay/receipt affordance — not a data-viz widget, and no longer a
// pile of stacked text (Rafael's call, 2026-07-14). Four intentional layers:
//   1. the verdict AS the hero — big, worst-first (an <h2>: this renders only
//      inside the system-status HoverCard since the 2026-07-14 rebuild, so it
//      is no longer the page heading. The route's <h1> lives in
//      app/(app)/dashboard/page.tsx);
//   2. the actual problem assets as clickable chips (not buried in prose);
//   3. the digest facts as glanceable stat-objects (labeled units);
//   4. the trust primitive as a real chip, not a whispered footnote.
// Renders as static text; LiveStateAnnouncer (mounted once at the page level)
// remains the sole aria-live region, so this block carries none of its own.
export interface ProblemAsset {
  symbol: string;
  state: PegState;
  bps: number;
  hasBps: boolean;
}

export function DashboardVerdict({
  counts,
  closest,
  transition,
  problemAssets,
  nowMs,
  className,
}: {
  counts: VerdictCounts;
  closest: ClosestToBand | null;
  transition: LastTransition | null;
  /** Worst-first, UNFILTERED (ignores board view/class/search pills) — the top
   *  problem assets across the whole tracked universe. Empty on a calm day. */
  problemAssets: ProblemAsset[];
  nowMs: number;
  className?: string;
}) {
  const headline = verdictHeadline(counts);
  const severe = counts.offPeg > 0;
  const hasStats = !!closest || !!transition;

  return (
    // No bottom hairline of its own: the verdict + the secondary vitals row
    // below it read as ONE hero unit, closed off by the vitals row's border.
    <section className={cn("pb-4 pt-7 sm:pt-9", className)}>
      {/* 1. Verdict AS the hero — worst-first, same headline logic, now the
          only text at this weight so it commands the page. */}
      <h2
        className={cn(
          "max-w-[46ch] text-balance text-[28px] font-medium leading-[1.1] tracking-[-0.02em] sm:text-[36px]",
          severe ? "text-st-depeg-text" : "text-text",
        )}
      >
        {headline}
      </h2>

      {/* 2. Problem-asset chips — the actual assets, clickable, worst-first.
          Absent entirely on a calm day (not an empty row). */}
      {problemAssets.length > 0 && (
        <div
          aria-label="Assets off peg or drifting, worst first"
          className="mt-4 flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden"
        >
          {problemAssets.map((p) => (
            <VerdictChip
              key={p.symbol}
              symbol={p.symbol}
              state={p.state}
              bps={p.bps}
              hasBps={p.hasBps}
            />
          ))}
        </div>
      )}

      {/* 3. Glanceable stat-objects — closest-to-band / last-transition, each a
          compact labeled unit instead of a run-on sentence. */}
      {hasStats && (
        <div className="mt-4 flex flex-wrap items-stretch gap-2">
          {closest && (
            <VerdictStat label="Closest to band">
              <Link
                href={`/asset/${encodeURIComponent(closest.symbol)}`}
                className="hover:underline"
              >
                {displaySymbol(closest.symbol)} ·{" "}
                {formatBandAwayPct(closest.bpsAway)} away
              </Link>
            </VerdictStat>
          )}
          {transition && (
            <VerdictStat
              label="Last transition"
              href={`/audit/${transition.alertId}`}
            >
              {displaySymbol(transition.symbol)}{" "}
              {stateMeta(transition.from).label}→
              {stateMeta(transition.to).label} ·{" "}
              {relativeStamp(transition.detectedAt, nowMs) ?? "recently"}
              <span className="ml-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted">
                receipt →
              </span>
            </VerdictStat>
          )}
        </div>
      )}

      {/* 4. Trust chip — real chip, not a whispered mono footnote. */}
      <Link
        href="/audit"
        // Also a pill, not a card: rounded-full over a surface-2/40 wash,
        // and its hover changes TEXT colour rather than a border. Left as a
        // literal so the `color` transition survives; cardSurface exists for
        // rectangular panels.
        className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-2/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption transition-[box-shadow,transform,color] duration-150 ease-out hover:text-text hover:ring-2 hover:ring-outline/80 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        Byte-exact replayable
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
