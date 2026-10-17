"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import { StatePip } from "@/components/atoms/state-pip";
import { stateMeta } from "@/lib/asset/state-meta";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AlertRow, PegState } from "@/lib/api/types";

interface ActivityTimelineProps {
  alerts: AlertRow[] | undefined;
  className?: string;
  /** Clicking a row asks the (possibly-unmounted, on another tab) chart to
   *  scrub to that instant. Omitted entirely disables the interaction
   *  (rows render as plain text, no buttons) — kept optional so any other
   *  caller of this organism isn't forced to wire scrubbing. */
  onScrub?: (id: string, tsSec: number, state: PegState) => void;
  /** Id of the event row currently driving the chart's scrubbed range — drawn
   *  with an active affordance; clicking it again clears the scrub. */
  scrubbedId?: string | null;
  /** Id of the event row whose timestamp fell outside the chart's currently
   *  loaded history window on the last click — shown with an inline "outside
   *  loaded range" hint instead of silently doing nothing. */
  outOfRangeId?: string | null;
}

// One row per *meaningful* event. Consecutive transitions into the same
// to_state within ~30 minutes collapse — the user doesn't need to see "DRIFT
// DRIFT DRIFT DRIFT" hammered out by hysteresis noise.
interface Event {
  id: string;
  from_state: PegState;
  to_state: PegState;
  start: string;
  count: number; // how many raw alerts collapsed into this event
  duration_ms: number | null; // how long this state held before the next event
}

function dayBucket(iso: string): string {
  return iso.slice(0, 10);
}

function dayLabel(day: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (day === today) return "Today";
  const yest = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (day === yest) return "Yesterday";
  return new Date(day + "T00:00:00Z").toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function clockLabel(iso: string): string {
  // Explicit UTC: this renders during SSR (server render matches hydration),
  // so an implicit local timezone here would diff between the server's TZ
  // and the visitor's browser TZ and trip a hydration mismatch.
  return new Date(iso).toLocaleTimeString("en", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "still active";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)} days`;
}

const stateLabelLow: Record<PegState, string> = {
  PEGGED: "pegged",
  DRIFT: "drifting",
  DEPEG: "depegged",
  CRITICAL: "critical",
  BLACK_SWAN: "black swan",
  UNKNOWN: "unknown",
};

function collapse(raw: AlertRow[]): Event[] {
  // raw is sorted desc by detected_at from the API.
  // Walk oldest→newest so consecutive same-to_state events fold into the first one.
  const asc = [...raw].sort((a, b) =>
    a.detected_at.localeCompare(b.detected_at),
  );
  const out: Event[] = [];
  for (const a of asc) {
    const last = out[out.length - 1];
    const ts = new Date(a.detected_at).getTime();
    if (last) {
      const lastTs = new Date(last.start).getTime();
      // Same to_state and within 30 min → fold.
      if (last.to_state === a.to_state && ts - lastTs < 30 * 60_000) {
        last.count += 1;
        continue;
      }
      // Otherwise, close the previous event's duration.
      last.duration_ms = ts - lastTs;
    }
    out.push({
      id: a.id,
      from_state: a.from_state,
      to_state: a.to_state,
      start: a.detected_at,
      count: 1,
      duration_ms: null,
    });
  }
  return out.reverse(); // newest first for rendering
}

// Each state has a vertical position on the sparkline canvas. PEGGED sits at
// the bottom (safe), CRITICAL at the top (bad). Reading the curve is then
// intuitive: down = improving, up = worsening, distance = how big the jump.
const SVG_W = 200;
const SVG_H = 32;
const BAND_Y: Record<PegState, number> = {
  CRITICAL: 5,
  BLACK_SWAN: 5,
  DEPEG: 12,
  DRIFT: 20,
  PEGGED: 28,
  UNKNOWN: 16,
};

const BAND_STROKE: Record<PegState, string> = {
  PEGGED: "var(--color-st-pegged)",
  DRIFT: "var(--color-st-drift)",
  DEPEG: "var(--color-st-depeg)",
  CRITICAL: "var(--color-st-critical)",
  BLACK_SWAN: "var(--color-st-critical)",
  UNKNOWN: "var(--color-text-muted)",
};

/**
 * Band-step visualization for one event. A smooth curve drops or climbs
 * between the from_state band and the to_state band, with dots anchoring
 * both ends and a marker at the transition midpoint. Always renders — no
 * dependence on history data. Distinct visual per transition pair, so a
 * scan-down-the-list reads "→ drift → pegged → drift → pegged → depeg" as
 * a clear shape pattern instead of 30 near-identical sparklines.
 */
function EventSparkline({ event }: { event: Event }) {
  const fromY = BAND_Y[event.from_state];
  const toY = BAND_Y[event.to_state];
  const improving = toY > fromY; // lower in the SVG = closer to PEGGED = improving
  const lateral = fromY === toY;

  let stroke: string;
  if (lateral) {
    stroke = "var(--color-text-muted)";
  } else if (improving) {
    stroke = BAND_STROKE.PEGGED;
  } else {
    stroke = BAND_STROKE[event.to_state];
  }

  const midX = SVG_W / 2;
  const stepWidth = 24;
  const ax = midX - stepWidth;
  const bx = midX + stepWidth;
  // Cubic bezier for a smooth S-curve transition between the two plateaus.
  const d = `M0,${fromY} L${ax},${fromY} C${midX},${fromY} ${midX},${toY} ${bx},${toY} L${SVG_W},${toY}`;

  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      preserveAspectRatio="none"
      className="h-8 w-[140px] flex-none sm:w-[200px]"
      role="img"
      aria-label={`${stateLabelLow[event.from_state]} to ${stateLabelLow[event.to_state]}`}
    >
      {/* Pegged baseline — the only band guide; the eye uses it to read
          "how far above the safe zone" without needing labels on every row. */}
      <line
        x1="0"
        y1={BAND_Y.PEGGED}
        x2={SVG_W}
        y2={BAND_Y.PEGGED}
        stroke="var(--color-hairline)"
        strokeWidth="0.5"
      />
      {/* From-state anchor */}
      <circle
        cx="2"
        cy={fromY}
        r="1.6"
        fill={BAND_STROKE[event.from_state]}
        opacity="0.55"
      />
      {/* The transition curve */}
      <path
        d={d}
        stroke={stroke}
        strokeWidth="1.5"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
      {/* Transition midpoint — the moment the state flipped */}
      <circle
        cx={midX}
        cy={(fromY + toY) / 2}
        r="2.6"
        fill="var(--color-canvas)"
        stroke={stroke}
        strokeWidth="1.4"
        vectorEffect="non-scaling-stroke"
      />
      {/* To-state anchor — slightly larger, since "where it landed" is what
          the row's text label is also describing. */}
      <circle
        cx={SVG_W - 2}
        cy={toY}
        r="2.2"
        fill={BAND_STROKE[event.to_state]}
      />
    </svg>
  );
}

export function ActivityTimeline({
  alerts,
  className,
  onScrub,
  scrubbedId,
  outOfRangeId,
}: ActivityTimelineProps) {
  const events = useMemo(() => (alerts ? collapse(alerts) : []), [alerts]);

  // Group by day for sticky-day headers.
  const byDay = useMemo(() => {
    const m = new Map<string, Event[]>();
    for (const ev of events) {
      const day = dayBucket(ev.start);
      const arr = m.get(day) ?? [];
      arr.push(ev);
      m.set(day, arr);
    }
    return [...m.entries()];
  }, [events]);

  return (
    <div className={cn(className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[28px] font-medium leading-[1.1] tracking-[-0.01em] text-text">
          Activity timeline
        </h2>
        {events.length > 0 && (
          <span className="font-mono text-[11px] text-text-muted">
            {events.length} transition{events.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <p className="mb-6 mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
        Verified state-change ledger · click a row to scrub the chart
      </p>

      <div className="rounded-[20px] border border-hairline bg-surface-1 p-5 sm:p-6">
        {/* One-line legend, so a first-time reader can decode the small
            right-hand chart at a glance. Drops out on mobile to keep rows tight. */}
        {events.length > 0 && (
          <p className="mb-6 hidden font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted/80 sm:block">
            Chart reads top → bottom: critical · depeg · drift · pegged. Line
            going down = improving.
          </p>
        )}

        {!alerts && (
          <div>
            <span className="sr-only">Loading timeline</span>
            <div className="animate-pulse space-y-3" aria-hidden>
              <div className="h-4 w-3/4 rounded-full bg-surface-2" />
              <div className="h-4 w-1/2 rounded-full bg-surface-2" />
              <div className="h-4 w-2/3 rounded-full bg-surface-2" />
            </div>
          </div>
        )}
        {alerts && events.length === 0 && (
          <div className="py-6 text-center">
            <p className="font-mono text-[12px] text-text-muted">
              No state transitions on record.
            </p>
            <p className="mt-1 font-mono text-[11px] text-text-muted/70">
              A clean ledger; this asset has stayed within its peg threshold
              across the recent window.
            </p>
          </div>
        )}

        <ol className="grid gap-8">
          {byDay.map(([day, evs], dayIdx) => (
            <li key={day}>
              <div className="mb-3 flex items-baseline gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-text">
                  {dayLabel(day)}
                </span>
                <span className="h-px flex-1 bg-hairline" />
                <span className="font-mono text-[10px] text-text-muted">
                  {evs.length} event{evs.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="grid gap-px">
                {evs.map((ev, evIdx) => {
                  const isFresh = dayIdx === 0 && evIdx === 0;
                  const isScrubbed = scrubbedId === ev.id;
                  const isOutOfRange = outOfRangeId === ev.id;
                  const fullStamp = new Date(ev.start).toLocaleString("en", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "UTC",
                  });
                  return (
                    <li
                      key={ev.id}
                      className={cn(
                        "border-b border-hairline",
                        // Solid brand accent (never the iridescent gradient —
                        // the page budgets that one moment on the CTA below).
                        isFresh && "border-l-2 border-l-coral pl-3",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          onScrub?.(
                            ev.id,
                            Math.floor(new Date(ev.start).getTime() / 1000),
                            ev.to_state,
                          )
                        }
                        aria-label={`Show chart at ${fullStamp}`}
                        aria-pressed={isScrubbed}
                        disabled={!onScrub}
                        className={cn(
                          "grid w-full grid-cols-[64px_1fr_140px_auto] items-center gap-3 px-1 py-3 text-left font-mono text-[12px] transition-colors duration-200 sm:grid-cols-[80px_1fr_200px_auto] sm:gap-5",
                          onScrub && "hover:bg-text/[0.025]",
                          isScrubbed && "bg-text/[0.04]",
                          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-outline",
                          !onScrub && "cursor-default",
                        )}
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <time
                              dateTime={ev.start}
                              // Focusable: the tooltip carries the FULL
                              // timestamp while the visible label is a short
                              // clock, so keyboard users had no way to read the
                              // date. `dateTime` already gives AT the machine
                              // value; tabIndex makes the tooltip reachable too.
                              tabIndex={0}
                              className="cursor-help text-text tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
                            >
                              {clockLabel(ev.start)}
                            </time>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {fullStamp}
                          </TooltipContent>
                        </Tooltip>
                        <div className="flex flex-wrap items-center gap-2 text-text-muted">
                          <span className="lowercase">
                            {stateLabelLow[ev.from_state]}
                          </span>
                          <span aria-hidden>→</span>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5",
                              stateMeta(ev.to_state).textClass,
                            )}
                          >
                            <StatePip
                              state={ev.to_state}
                              pulse={ev.to_state !== "PEGGED"}
                              size={5}
                              announce
                            />
                            {stateLabelLow[ev.to_state]}
                          </span>
                          {ev.count > 1 && (
                            <span className="border border-hairline px-1.5 py-px text-[9px] uppercase tracking-[0.1em] text-text-muted">
                              ×{ev.count}
                            </span>
                          )}
                        </div>
                        <EventSparkline event={ev} />
                        <span className="text-text-muted/80 text-[11px]">
                          {ev.duration_ms == null
                            ? "still active"
                            : `held ${fmtDuration(ev.duration_ms)}`}
                        </span>
                      </button>
                      {isOutOfRange && (
                        <p className="px-1 pb-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption">
                          Outside loaded range on Overview
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
