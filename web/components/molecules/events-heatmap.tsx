"use client";

import { Fragment, useMemo, useRef } from "react";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";
import { getScrollTrigger } from "@/lib/motion/gsap";
import { revealSafety } from "@/lib/motion/gsap-reveal-safety";
import { formatDayUS } from "@/lib/api/format";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  /** Map of YYYY-MM-DD → event count, or `null` when the stream has not
   *  arrived. The distinction matters: a grid rendered from an empty object is
   *  365 cells of "no activity", which is a specific and reassuring claim about
   *  the year. Rendered from nothing, it is a lie told calmly. */
  buckets: Record<string, number> | null;
  /** UTC day (YYYY-MM-DD) at or before which the feed was cut off by the
   *  paging cap. Those cells are drawn as "coverage incomplete", never as a
   *  quiet day. `null`/absent when the whole year was fetched. */
  unknownThroughDay?: string | null;
}

const ROW_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

function intensityClass(count: number): string {
  if (count === 0) return "bg-hairline";
  if (count <= 1) return "bg-st-drift/30";
  if (count <= 3) return "bg-st-drift/60";
  if (count <= 6) return "bg-st-depeg/70";
  return "bg-st-critical";
}

export function EventsHeatmap({ buckets, unknownThroughDay = null }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Generate 52 weeks × 7 days ending today
  const cells = useMemo(() => {
    const out: {
      date: string;
      dow: number;
      count: number;
      unknown: boolean;
    }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Walk back 364 days from today, day-by-day
    for (let i = 363; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      out.push({
        date: iso,
        dow: d.getDay(),
        count: buckets?.[iso] ?? 0,
        unknown: unknownThroughDay != null && iso <= unknownThroughDay,
      });
    }
    return out;
  }, [buckets, unknownThroughDay]);

  // Group into 52 weeks (columns)
  const weeks = useMemo(() => {
    const cols: (typeof cells)[] = [];
    let current: typeof cells = [];
    for (const c of cells) {
      current.push(c);
      if (c.dow === 6) {
        cols.push(current);
        current = [];
      }
    }
    if (current.length > 0) cols.push(current);
    return cols;
  }, [cells]);

  useReducedMotionGsap((gsap, reduced) => {
    const root = rootRef.current;
    if (!root || reduced) return;
    const divs = root.querySelectorAll<HTMLElement>("[data-heatmap-cell]");
    let tween: gsap.core.Tween | null = null;
    const safety = revealSafety(Array.from(divs));
    (async () => {
      await getScrollTrigger();
      tween = gsap.fromTo(
        divs,
        { opacity: 0 },
        {
          opacity: 1,
          duration: 0.3,
          ease: "power2.out",
          stagger: { each: 0.003, from: "start" },
          immediateRender: false,
          scrollTrigger: {
            trigger: root,
            start: "top 85%",
            toggleActions: "play none none none",
          },
        },
      );
    })();
  return () => {
      tween?.kill();
      safety();
    };
  }, []);

  // After every hook, so the hook count cannot change between renders. Renders
  // instead of the grid: 365 cells at "no activity" is a specific claim about
  // the year, and drawing it from absent data states it confidently.
  if (buckets === null) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-caption">
        Activity unavailable
      </p>
    );
  }

  return (
    <div ref={rootRef}>
      <div className="flex items-start gap-2">
        {/* Day-of-week labels */}
        <div className="flex flex-col gap-[3px] pt-[2px]">
          {ROW_LABELS.map((l, i) => (
            <span
              key={i}
              className="h-3 font-mono text-[9px] uppercase tracking-[0.06em] text-text-muted"
            >
              {l}
            </span>
          ))}
        </div>
        {/* Grid */}
        <div className="flex gap-[3px] overflow-x-auto pb-1">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {Array.from({ length: 7 }, (_, dow) => {
                const cell = week.find((c) => c.dow === dow);
                if (!cell) {
                  // No-data slot: inert on purpose — nothing to announce, and
                  // making 365 empty cells focusable would bury the real ones.
                  return (
                    <Fragment key={dow}>
                      <div
                        data-heatmap-cell
                        aria-hidden="true"
                        className="h-3 w-3 bg-transparent"
                      />
                    </Fragment>
                  );
                }
                // A day WITH events was a bare <div>: not focusable, no text, so
                // its date and count existed ONLY in a hover tooltip. The
                // accessible name duplicates that tooltip so the heatmap is
                // readable without a mouse.
                const cellEl = (
                  <button
                    type="button"
                    data-heatmap-cell
                    data-unknown={cell.unknown ? "true" : undefined}
                    aria-label={
                      cell.unknown
                        ? `${formatDayUS(cell.date)}: coverage incomplete`
                        : `${formatDayUS(cell.date)}: ${cell.count} ${cell.count === 1 ? "event" : "events"}`
                    }
                    className={`h-3 w-3 cursor-help ${
                      cell.unknown
                        ? "border border-dashed border-hairline bg-transparent"
                        : intensityClass(cell.count)
                    } focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-text`}
                  />
                );
                return (
                  <Tooltip key={dow}>
                    <TooltipTrigger asChild>{cellEl}</TooltipTrigger>
                    <TooltipContent>
                      {cell.unknown
                        ? `${formatDayUS(cell.date)} · coverage incomplete`
                        : `${formatDayUS(cell.date)} · ${cell.count} events`}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {/* Legend */}
      <div className="mt-3 flex items-center justify-end gap-1 font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted">
        <span>Less</span>
        <span className="h-3 w-3 bg-hairline" />
        <span className="h-3 w-3 bg-st-drift/30" />
        <span className="h-3 w-3 bg-st-drift/60" />
        <span className="h-3 w-3 bg-st-depeg/70" />
        <span className="h-3 w-3 bg-st-critical" />
        <span>More</span>
        {unknownThroughDay != null && (
          <>
            <span className="ml-2 h-3 w-3 border border-dashed border-hairline" />
            <span>Not loaded</span>
          </>
        )}
      </div>
    </div>
  );
}
