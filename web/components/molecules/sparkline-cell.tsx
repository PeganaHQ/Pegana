"use client";

import { useMemo } from "react";
import { useHistory } from "@/lib/hooks/use-history";
import { isPlausibleDiscount } from "@/lib/api/format";
import { Sparkline } from "@/components/atoms/sparkline";

interface SparklineCellProps {
  symbol: string;
  /** Inline 24h discount series straight off the asset payload (`series_24h`).
   *  When provided the cell renders from it with ZERO network requests — every
   *  /v1/assets row already ships this array. Only when it's absent do we fall
   *  back to a /history fetch. This kills the per-row, per-render refetch storm
   *  that the drifting `Date.now()` SWR key used to cause. */
  series?: number[];
  /** 24h trend color follows whichever side of zero the latest sample is on. */
  className?: string;
  /** Optional depeg-line ruler (bps) — see Sparkline's `thresholdBps` doc.
   *  Omitted by default; callers that have a per-asset threshold (e.g. via
   *  `thresholdsFor`) can pass `t.depeg_bps` to draw the reference line. */
  thresholdBps?: number;
  /** Optional stroke override. Omitted by default, so the single-asset board
   *  and screener keep the trend coloring (green/amber/rose by 24h direction).
   *  Multi-asset contexts that already own a per-slot color — Compare, where the
   *  card's top edge and its chart line share one hue — pass it so the sparkline
   *  reads as part of that one color identity instead of contradicting it. */
  color?: string;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// Per-row 24h sparkline. Prefers the inline `series_24h` from the asset payload
// (no request); falls back to a deduped /history fetch only when it's missing.
export function SparklineCell({
  symbol,
  series,
  className,
  thresholdBps,
  color: colorOverride,
}: SparklineCellProps) {
  // Memoise the from/limit so the SWR key stays stable across re-renders.
  const params = useMemo(
    () => ({
      bucket: "1m" as const,
      from: new Date(Date.now() - ONE_DAY_MS).toISOString(),
      limit: 200,
    }),
    [],
  );
  // Disable the fetch entirely when we were handed an inline series.
  const { data } = useHistory(series == null ? symbol : null, params);

  const { points, color } = useMemo(() => {
    // Inline series (decimal discounts) wins; otherwise the fetched history.
    const bps: number[] =
      series != null
        ? series.filter((v) => isPlausibleDiscount(v)).map((v) => v * 10000)
        : data && data.length >= 2
          ? data
              .filter((p) => isPlausibleDiscount(p.discount))
              .map((p) => parseFloat(p.discount) * 10000)
          : [];
    if (bps.length < 2)
      return { points: [] as number[], color: "var(--color-text-muted)" };
    const last = bps[bps.length - 1];
    const first = bps[0];
    const c =
      Math.abs(last) < 30
        ? "var(--color-st-pegged)"
        : last < first
          ? "var(--color-st-drift)"
          : "var(--color-st-depeg)";
    return { points: bps, color: c };
  }, [series, data]);

  if (points.length < 2) {
    return <div className={className} aria-hidden />;
  }

  return (
    <Sparkline
      className={className}
      height={28}
      stroke={colorOverride ?? color}
      showFill
      points={points}
      thresholdBps={thresholdBps}
    />
  );
}
