"use client";

import { useMemo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AlertRow } from "@/lib/api/types";

// Distribution of recovery times — when this asset crosses out of band,
// how long does it usually take to return to PEGGED? Real data derived
// from the asset's alert history: pair each out-of-band transition with
// its next return-to-PEGGED transition.
//
// 4 stat cells (p50/p75/p95/p99) + 20-bucket histogram below.

interface TimeToRecoveryProps {
  alerts: AlertRow[] | undefined;
}

const BUCKETS_MIN = [
  0, 1, 2, 3, 5, 7, 10, 15, 20, 25, 30, 40, 50, 60, 75, 90, 120, 180, 240, 360,
];

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx];
}

function fmtMins(min: number | null): { v: string; u: string } {
  if (min == null) return { v: "-", u: "" };
  if (min < 60) return { v: min.toFixed(0), u: "min" };
  if (min < 1440) return { v: (min / 60).toFixed(1), u: "h" };
  return { v: (min / 1440).toFixed(1), u: "d" };
}

export function TimeToRecovery({ alerts }: TimeToRecoveryProps) {
  const stats = useMemo(() => {
    if (!alerts || alerts.length === 0) {
      return {
        sample: 0,
        p50: null,
        p75: null,
        p95: null,
        p99: null,
        hist: [] as number[],
      };
    }
    const chrono = alerts.slice().reverse();
    const recoveries: number[] = [];
    let outAt: number | null = null;
    for (const a of chrono) {
      if (a.to_state !== "PEGGED" && outAt == null) {
        outAt = new Date(a.detected_at).getTime();
      } else if (a.to_state === "PEGGED" && outAt != null) {
        const dt = new Date(a.detected_at).getTime() - outAt;
        recoveries.push(dt / 60_000);
        outAt = null;
      }
    }
    if (recoveries.length === 0) {
      return {
        sample: 0,
        p50: null,
        p75: null,
        p95: null,
        p99: null,
        hist: [] as number[],
      };
    }
    recoveries.sort((a, b) => a - b);

    // Bucket each recovery into the BUCKETS_MIN bins.
    const hist = new Array(BUCKETS_MIN.length).fill(0);
    for (const r of recoveries) {
      let placed = false;
      for (let i = 0; i < BUCKETS_MIN.length - 1; i++) {
        if (r >= BUCKETS_MIN[i] && r < BUCKETS_MIN[i + 1]) {
          hist[i] += 1;
          placed = true;
          break;
        }
      }
      if (!placed) hist[hist.length - 1] += 1;
    }

    return {
      sample: recoveries.length,
      p50: percentile(recoveries, 50),
      p75: percentile(recoveries, 75),
      p95: percentile(recoveries, 95),
      p99: percentile(recoveries, 99),
      hist,
    };
  }, [alerts]);

  const histMax = stats.hist.length > 0 ? Math.max(...stats.hist, 1) : 1;
  const empty = stats.sample === 0;

  return (
    <div>
      <h2 className="text-[28px] font-medium leading-[1.1] tracking-[-0.01em] text-text">
        Time to recovery
      </h2>
      <p className="mb-6 mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
        When this asset drifts past threshold · distribution of recovery time ·
        sample of {stats.sample}
      </p>

      <div className="rounded-[20px] border border-hairline bg-surface-1 p-5 sm:p-6">
        <div className="mb-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Cell k="Median (p50)" raw={stats.p50} />
          <Cell k="p75" raw={stats.p75} />
          <Cell k="p95" raw={stats.p95} />
          <Cell k="Worst (p99)" raw={stats.p99} />
        </div>

        {empty ? (
          <p className="py-4 text-center font-mono text-[11px] text-text-caption">
            No recovery samples in window; this asset has not exited PEGGED
            yet, or the alert stream is empty.
          </p>
        ) : (
          <>
            <div className="flex h-24 items-end gap-[3px]">
              {stats.hist.map((n, i) => (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    {/* A focusable <button> with an explicit name, not a bare
                        <div>: the bar has no text of its own, so the tooltip is
                        the ONLY way to read the histogram at all — and a <div>
                        is neither focusable (Radix's asChild trigger never fires
                        onFocus) nor announced. Keyboard and screen-reader users
                        previously got a wall of coloured rectangles with no
                        values. */}
                    <button
                      type="button"
                      aria-label={`${BUCKETS_MIN[i]}–${BUCKETS_MIN[i + 1] ?? "∞"} minutes: ${n} ${n === 1 ? "event" : "events"}`}
                      className="flex-1 cursor-help bg-st-pegged transition-opacity duration-200 hover:opacity-100"
                      style={{
                        height: `${Math.max(2, (n / histMax) * 100)}%`,
                        opacity: n === 0 ? 0.15 : 0.65,
                      }}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top">{`${BUCKETS_MIN[i]}–${BUCKETS_MIN[i + 1] ?? "∞"} min · ${n} ${n === 1 ? "event" : "events"}`}</TooltipContent>
                </Tooltip>
              ))}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[9px] tracking-[0.06em] text-text-caption">
              <span>&lt; 5 min</span>
              <span>15 min</span>
              <span>30 min</span>
              <span>1h</span>
              <span>6h+</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Cell({ k, raw }: { k: string; raw: number | null }) {
  const { v, u } = fmtMins(raw);
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-caption">
        {k}
      </div>
      <div className="mt-1.5 font-mono text-[28px] font-medium tabular-nums leading-none tracking-[-0.02em] text-text sm:text-[30px]">
        {v}
        {u && (
          <span className="ml-1 text-[14px] font-normal text-text-muted">
            {u}
          </span>
        )}
      </div>
    </div>
  );
}
