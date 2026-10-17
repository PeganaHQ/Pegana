"use client";

import { useMemo } from "react";
import { useHistory30d } from "@/lib/hooks/use-history-30d";
import { formatDayUS } from "@/lib/api/format";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PegState } from "@/lib/api/types";

interface Props {
  symbol: string;
  className?: string;
}

const STATE_RANK: Record<PegState, number> = {
  PEGGED: 0,
  UNKNOWN: 0,
  DRIFT: 1,
  DEPEG: 2,
  CRITICAL: 3,
  BLACK_SWAN: 4,
};

const STATE_COLOR: Record<PegState, string> = {
  PEGGED: "bg-st-pegged/70",
  UNKNOWN: "bg-text-muted/30",
  DRIFT: "bg-st-drift/80",
  DEPEG: "bg-st-depeg/80",
  CRITICAL: "bg-st-critical/90",
  BLACK_SWAN: "bg-st-critical",
};

const STATE_LABEL: Record<PegState, string> = {
  PEGGED: "pegged",
  DRIFT: "drifting",
  DEPEG: "depegged",
  CRITICAL: "critical",
  BLACK_SWAN: "black swan",
  UNKNOWN: "no data",
};

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

// Always show a 30-day grid even when the asset hasn't transitioned recently.
// The point is to communicate "this is what stability looks like" — a full
// row of green is the strongest possible signal, much better than an empty
// "no events" state.
export function StateStrip30d({ symbol, className }: Props) {
  const { data: history, error } = useHistory30d(symbol);

  // Build a worst-state-per-day map. Missing days fall back to UNKNOWN so the
  // strip is always 30 cells wide.
  const byDay = useMemo(() => {
    const m = new Map<string, PegState>();
    if (history) {
      for (const p of history) {
        const k = dayKey(p.ts);
        const cur = m.get(k);
        if (!cur || STATE_RANK[p.state] > STATE_RANK[cur]) {
          m.set(k, p.state);
        }
      }
    }
    return m;
  }, [history]);

  const cells = useMemo(() => {
    const out: { day: string; state: PegState }[] = [];
    for (let i = 29; i >= 0; i--) {
      const k = daysAgo(i);
      out.push({ day: k, state: byDay.get(k) ?? "UNKNOWN" });
    }
    return out;
  }, [byDay]);

  // Tally for the legend sentence.
  const tally = useMemo(() => {
    const t: Partial<Record<PegState, number>> = {};
    for (const c of cells) t[c.state] = (t[c.state] ?? 0) + 1;
    return t;
  }, [cells]);

  if (error && !history) {
    return null;
  }

  const peggedDays = tally.PEGGED ?? 0;
  const unknownDays = tally.UNKNOWN ?? 0;
  const trackedDays = 30 - unknownDays;
  const peggedShare = trackedDays > 0 ? peggedDays / trackedDays : null;

  // If the asset only has data for a thin slice of the window, the "X% of
  // tracked days pegged · N days no data" framing makes a brand-new
  // tracked asset look broken. Reframe as "tracked since DATE" so the
  // missing days read as "before we were watching" rather than "data
  // gap".
  const trackedCells = cells.filter((c) => c.state !== "UNKNOWN");
  const firstTrackedDay = trackedCells[0]?.day;
  const isFreshlyTracked = trackedDays > 0 && trackedDays < 14;

  return (
    <section
      className={cn(
        "rounded-[20px] border border-hairline bg-surface-1 p-5 sm:p-6",
        className,
      )}
    >
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[28px] font-medium leading-[1.1] tracking-[-0.01em] text-text">
          Last 30 days
        </h2>
        <span className="font-mono text-[11px] text-text-muted">
          {peggedShare != null && (
            <>
              {isFreshlyTracked && firstTrackedDay ? (
                <>
                  <span className="text-text">
                    tracked since {formatDayUS(firstTrackedDay)}
                  </span>{" "}
                  ·{" "}
                  <span className="text-text">
                    {(peggedShare * 100).toFixed(0)}%
                  </span>{" "}
                  pegged in window
                </>
              ) : (
                <>
                  <span className="text-text">
                    {(peggedShare * 100).toFixed(0)}%
                  </span>{" "}
                  of tracked days pegged
                  {unknownDays > 0 && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="text-text-muted/60">
                        {unknownDays} day{unknownDays === 1 ? "" : "s"} no data
                      </span>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </span>
      </header>

      <ol
        className="grid grid-cols-[repeat(15,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(30,minmax(0,1fr))]"
        role="list"
        aria-label={`30-day peg state for ${displaySymbol(symbol)}`}
      >
        {cells.map((c) => (
          <Tooltip key={c.day}>
            <TooltipTrigger asChild>
              <li
                // A bare <li> is not focusable, so this strip's per-day state
                // was mouse-only. tabIndex + a name make each cell reachable
                // and readable; the Tooltip still supplies the visual detail.
                tabIndex={0}
                aria-label={`${c.day}: ${c.state}`}
                className={cn(
                  "h-7 w-full transition-colors duration-300 hover:ring-1 hover:ring-text/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text",
                  STATE_COLOR[c.state],
                )}
              />
            </TooltipTrigger>
            <TooltipContent>{`${formatDayUS(c.day)} · ${STATE_LABEL[c.state]}`}</TooltipContent>
          </Tooltip>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        <LegendDot state="PEGGED" /> pegged
        <LegendDot state="DRIFT" /> drift
        <LegendDot state="DEPEG" /> depeg
        <LegendDot state="CRITICAL" /> critical
        <LegendDot state="UNKNOWN" /> no data
      </div>
    </section>
  );
}

function LegendDot({ state }: { state: PegState }) {
  return (
    <span
      aria-hidden
      className={cn(
        "ml-2 inline-block h-2.5 w-2.5 first:ml-0",
        STATE_COLOR[state],
      )}
    />
  );
}
