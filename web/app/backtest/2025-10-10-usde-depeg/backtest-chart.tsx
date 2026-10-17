"use client";

import {
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AlertThresholds } from "@/lib/alerts/policy";
import { formatGap } from "@/lib/api/format";
import { thresholdAreaSpecs } from "@/lib/asset/chart-thresholds";

import type { ChartPoint } from "./backtest-data";

type TransitionMarker = {
  t: string;
  to: string;
};

const STATE_COLOR: Record<string, string> = {
  PEGGED: "var(--color-st-pegged)",
  DRIFT: "var(--color-st-drift)",
  DEPEG: "var(--color-st-depeg)",
  CRITICAL: "var(--color-st-critical)",
  BLACK_SWAN: "var(--color-st-critical)",
  UNKNOWN: "var(--color-st-unknown)",
};

const TIME_FORMATTER = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

function formatTime(value: number) {
  return TIME_FORMATTER.format(value);
}

export function BacktestChart({
  symbol,
  points,
  transitions,
  thresholds,
  directionSensitive,
}: {
  symbol: string;
  points: ChartPoint[];
  transitions: TransitionMarker[];
  thresholds: AlertThresholds;
  directionSensitive: boolean;
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center border border-hairline bg-surface-1 text-sm text-text-muted">
        No aligned price points for this asset.
      </div>
    );
  }

  const maxMagnitude = Math.max(
    thresholds.critical_bps * 1.25,
    ...points.map((point) => Math.abs(point.bps)),
  );
  const areaColors = {
    drift: "var(--color-st-drift)",
    depeg: "var(--color-st-depeg)",
    critical: "var(--color-st-critical)",
  } as const;

  return (
    <div
      role="img"
      aria-label={
        symbol +
        " discount in percent from October 9 through October 12, with methodology transition markers"
      }
      className="h-56 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={points}
          margin={{ top: 12, right: 8, bottom: 4, left: 0 }}
        >
          {thresholdAreaSpecs(thresholds, maxMagnitude, directionSensitive).map(
            (area) => (
              <ReferenceArea
                key={`${area.role}-${area.y1}`}
                y1={area.y1}
                y2={area.y2}
                fill={areaColors[area.role]}
                fillOpacity={0.08}
              />
            ),
          )}
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            scale="time"
            tickFormatter={formatTime}
            minTickGap={44}
            tick={{ fill: "var(--color-text-caption)", fontSize: 10 }}
            axisLine={{ stroke: "var(--color-hairline)" }}
            tickLine={false}
          />
          <YAxis
            domain={[-maxMagnitude, maxMagnitude]}
            width={48}
            tickFormatter={(value: number) => formatGap(value)}
            tick={{ fill: "var(--color-text-caption)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            labelFormatter={(value) => formatTime(Number(value)) + " UTC"}
            formatter={(value) => [formatGap(Number(value)), "Discount"]}
            contentStyle={{
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-outline)",
              borderRadius: 0,
              color: "var(--color-text)",
              fontSize: 12,
            }}
          />
          <ReferenceLine y={0} stroke="var(--color-outline)" />
          {transitions.map((transition) => (
            <ReferenceLine
              key={transition.t + "-" + transition.to}
              x={Date.parse(transition.t)}
              stroke={STATE_COLOR[transition.to] ?? STATE_COLOR.UNKNOWN}
              strokeDasharray="3 3"
              strokeOpacity={0.8}
            />
          ))}
          <Line
            type="monotone"
            dataKey="bps"
            stroke="var(--color-text)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
