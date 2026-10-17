"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PegState } from "@/lib/api/types";

// Vercel-style 90-day uptime bars. Each bar is one day; color encodes state.
// `samples` is oldest-first (sample[0] = 90 days ago, sample[n-1] = today).
// If `samples` is shorter than `days`, the missing leading days render as
// "unknown" (faint outline).

interface UptimeBarsProps {
  days?: number;
  samples: PegState[];
  /** Optional onClick to expand a day; default is tooltip on hover. */
  onDayClick?: (index: number, state: PegState) => void;
}

const BAR_BG: Record<PegState, string> = {
  PEGGED: "bg-st-pegged/85 hover:bg-st-pegged",
  DRIFT: "bg-st-drift/85 hover:bg-st-drift",
  DEPEG: "bg-st-depeg/90 hover:bg-st-depeg",
  CRITICAL: "bg-st-critical/90 hover:bg-st-critical",
  BLACK_SWAN: "bg-st-critical/90 hover:bg-st-critical",
  UNKNOWN: "bg-text-muted/15 hover:bg-text-muted/30",
};

const STATE_LABEL: Record<PegState, string> = {
  PEGGED: "Operational",
  DRIFT: "Degraded",
  DEPEG: "Outage",
  CRITICAL: "Major outage",
  BLACK_SWAN: "Major outage",
  UNKNOWN: "No data",
};

function daysAgoLabel(daysAgo: number): string {
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return `${daysAgo} days ago`;
}

export function UptimeBars({
  days = 90,
  samples,
  onDayClick,
}: UptimeBarsProps) {
  const [hover, setHover] = useState<number | null>(null);

  // Pad samples on the left if we have fewer than `days`
  const padded: PegState[] = Array.from({ length: days }, (_, i) => {
    const offset = days - samples.length;
    if (i < offset) return "UNKNOWN";
    return samples[i - offset] ?? "UNKNOWN";
  });

  return (
    <div className="relative">
      <div className="flex h-[28px] gap-[2px]">
        {padded.map((state, i) => {
          const daysAgo = days - 1 - i;
          const className = cn(
            "h-full flex-1 transition-colors duration-150",
            onDayClick ? "cursor-pointer" : "cursor-default",
            BAR_BG[state],
          );
          if (!onDayClick) {
            return (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    // Was `<span aria-hidden>`: not focusable AND hidden from
                    // AT, so the per-day uptime status existed ONLY in a
                    // mouse-hover tooltip. The label duplicates the tooltip so
                    // the bar is readable without it.
                    aria-label={`${daysAgoLabel(daysAgo)}, ${STATE_LABEL[state]}`}
                    className={className}
                  />
                </TooltipTrigger>
                <TooltipContent>{`${daysAgoLabel(daysAgo)}, ${STATE_LABEL[state]}`}</TooltipContent>
              </Tooltip>
            );
          }
          return (
            <button
              key={i}
              type="button"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              onFocus={() => setHover(i)}
              onBlur={() => setHover((h) => (h === i ? null : h))}
              onClick={() => onDayClick?.(i, state)}
              aria-label={`${daysAgoLabel(daysAgo)}, ${STATE_LABEL[state]}`}
              className={className}
            />
          );
        })}
      </div>

      {/* Hover tooltip */}
      {hover !== null && (
        <div
          className="pointer-events-none absolute -top-12 z-10 -translate-x-1/2 whitespace-nowrap border border-outline bg-surface-1 px-3 py-2 font-mono text-[11px] shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
          style={{
            left: `calc(${(hover / days) * 100}% + ${100 / days / 2}%)`,
          }}
        >
          <div className="text-text-muted">
            {daysAgoLabel(days - 1 - hover)}
          </div>
          <div
            className={cn(
              "mt-0.5",
              padded[hover] === "PEGGED" && "text-st-pegged",
              padded[hover] === "DRIFT" && "text-st-drift",
              padded[hover] === "DEPEG" && "text-st-depeg-text",
              padded[hover] === "CRITICAL" && "text-st-critical-text",
              padded[hover] === "UNKNOWN" && "text-text-caption",
            )}
          >
            {STATE_LABEL[padded[hover] ?? "UNKNOWN"]}
          </div>
        </div>
      )}

      {/* Axis labels */}
      <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption">
        <span>{days} days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}
