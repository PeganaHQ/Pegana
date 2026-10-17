import { cn } from "@/lib/utils/cn";

interface SparklineProps {
  points: number[];
  className?: string;
  stroke?: string;
  fill?: string;
  height?: number;
  showFill?: boolean;
  /**
   * Optional ruler: draws ONE dashed horizontal reference line at this
   * level, inside the SAME scale as `points` (caller's responsibility to
   * keep units consistent — e.g. both in bps). The series' own domain is
   * NEVER extended to fit a distant threshold — that used to squash a
   * ±3bps pegged series flat against a ~50bps threshold, erasing its 24h
   * shape. Instead the natural domain (min/max of `points`, honest
   * scale-floor fallback included) is computed exactly as it would be
   * without a threshold at all, and the ruler is drawn only if the
   * threshold sits inside that domain OR within 20% of it past the
   * nearest edge — extended just enough to fit, and only on that edge.
   * A threshold further out than that is omitted entirely rather than
   * distorting the series' scale.
   *
   * This is a RULER, not an alarm: it never recolors with the alarm ramp
   * (drift/depeg/critical) — always the dim hairline family — regardless
   * of which side of it the series currently sits on. Omit entirely when
   * the asset has no meaningful threshold (never draw a fabricated line).
   */
  thresholdBps?: number;
}

function toPath(
  points: number[],
  w: number,
  h: number,
  thresholdBps?: number,
): { line: string; area: string; thresholdY: number | null } {
  const n = points.length;
  if (n < 2) return { line: "", area: "", thresholdY: null };
  // Single pass for min/max — avoids the spread-into-Math.min/.max pair, which
  // allocates argument arrays per call and blows the stack on long series.
  let min = points[0];
  let max = points[0];
  for (let i = 1; i < n; i++) {
    const v = points[i];
    if (v < min) min = v;
    else if (v > max) max = v;
  }
  // Natural domain — computed identically whether or not a threshold was
  // passed. It is NEVER extended to swallow a distant threshold; that was
  // the bug (a ±3bps pegged series flattened against a ~50bps ruler,
  // erasing its own 24h shape).
  const naturalRange = max - min;
  const hasThreshold = thresholdBps != null && Number.isFinite(thresholdBps);
  let domainMin = min;
  let domainMax = max;
  let thresholdVisible = false;
  if (hasThreshold) {
    const t = thresholdBps!;
    if (t >= min && t <= max) {
      // Already inside the natural domain — draw as-is, no extension.
      thresholdVisible = true;
    } else {
      // Out-of-range: only fold it in when it's within 20% of the natural
      // range past the NEAREST edge, and only extend that one edge, just
      // enough to fit it. Anything farther is omitted rather than
      // dragging the whole domain (and the series with it) toward it.
      const margin = naturalRange * 0.2;
      if (t < min && min - t <= margin) {
        domainMin = t;
        thresholdVisible = true;
      } else if (t > max && t - max <= margin) {
        domainMax = t;
        thresholdVisible = true;
      }
    }
  }
  const range = domainMax - domainMin || 1;
  const step = w / (n - 1);
  let line = "";
  for (let i = 0; i < n; i++) {
    const x = (i * step).toFixed(2);
    const y = (h - ((points[i] - domainMin) / range) * h).toFixed(2);
    line += (i === 0 ? "M" : " L") + x + "," + y;
  }
  const area = `${line} L${w.toFixed(2)},${h.toFixed(2)} L0,${h.toFixed(2)} Z`;
  const thresholdY = thresholdVisible
    ? h - ((thresholdBps! - domainMin) / range) * h
    : null;
  return { line, area, thresholdY };
}

export function Sparkline({
  points,
  className,
  stroke = "var(--color-st-drift)",
  // Default: no explicit fill → the area is a color-matched wash of the stroke
  // (see the area <path> below). Callers pass an explicit fill only to override.
  fill = "transparent",
  height = 36,
  showFill = true,
  thresholdBps,
}: SparklineProps) {
  const w = 200;
  const { line, area, thresholdY } = toPath(points, w, height, thresholdBps);
  return (
    <svg
      className={cn("block w-full", className)}
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/* Subtle area fill, color-matched to the line (a low-opacity wash of
          the stroke) so the sparkline reads as a real chart, not a bare line —
          instead of the old fixed amber `fill` that fought non-amber strokes. */}
      {showFill && area && (
        <path
          d={area}
          fill={fill === "transparent" ? stroke : fill}
          fillOpacity={0.11}
        />
      )}
      {thresholdY != null && (
        <line
          data-role="spark-threshold"
          x1={0}
          x2={w}
          y1={thresholdY}
          y2={thresholdY}
          stroke="var(--color-outline)"
          strokeWidth={1}
          strokeDasharray="3,2"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {line && (
        <path
          d={line}
          data-role="spark-line"
          stroke={stroke}
          // preserveAspectRatio="none" stretches the viewBox non-uniformly, which
          // would otherwise thin the stroke horizontally and distort the apparent
          // slope. non-scaling-stroke keeps a true, constant 2px line.
          vectorEffect="non-scaling-stroke"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
    </svg>
  );
}
