"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  LineSeries,
  LineStyle,
  type ISeriesApi,
  type IPriceLine,
  type IChartApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useHistory } from "@/lib/hooks/use-history";
import {
  formatGap,
  isPlausibleDiscount,
  spreadSignClass,
} from "@/lib/api/format";
import { cn } from "@/lib/utils/cn";
import { seriesColor } from "@/lib/compare/series-colors";
import { useTvChart } from "./tv-chart/use-tv-chart";
import { ExpandShell } from "./tv-chart/expand-shell";
import type { TvTokens } from "./tv-chart/theme";

interface CompareChartProps {
  symbols: string[];
  hours?: number;
  preview?: boolean;
  exportKey?: number;
  onExportPng?: (dataUrl: string) => void;
}

interface Sample {
  time: UTCTimestamp;
  value: number;
}

export function CompareChart({
  symbols,
  hours = 24,
  preview = false,
  exportKey = 0,
  onExportPng,
}: CompareChartProps) {
  const params = useMemo(
    () => ({
      bucket: "1m" as const,
      from: new Date(Date.now() - hours * 3600_000).toISOString(),
      limit: 2000,
    }),
    [hours],
  );

  // Hooks must be called unconditionally — pad up to 4 slots.
  const s0 = useHistory(symbols[0] ?? null, params);
  const s1 = useHistory(symbols[1] ?? null, params);
  const s2 = useHistory(symbols[2] ?? null, params);
  const s3 = useHistory(symbols[3] ?? null, params);
  const responses = [s0, s1, s2, s3];

  const seriesData = useMemo<Record<string, Sample[]>>(() => {
    // Depend on the stable per-series `.data` refs below, not the `responses`
    // array — that array is rebuilt every render, so a `[symbols, responses]`
    // dep never hits the memo (react-doctor: effect-dependency-recreated).
    const data = [s0.data, s1.data, s2.data, s3.data];
    const out: Record<string, Sample[]> = {};
    for (let i = 0; i < symbols.length; i++) {
      const rows = data[i];
      if (!rows) continue;
      // Bucket to the minute so close samples align on the time axis.
      const points = new Map<number, number>();
      for (const r of rows) {
        // Drop physically-impossible samples (|discount| > 1.0). A real
        // depeg never exceeds 100% economically, and one bad sample collapses
        // the Y-axis for every other series in the overlay.
        if (!isPlausibleDiscount(r.discount)) continue;
        const t = Math.round(new Date(r.ts).getTime() / 60000) * 60;
        // `discount` is raw-API-signed (positive = discount, negative =
        // premium). Negate here — the ONE place bps enters this chart's
        // pipeline — so the plotted line, axis, tooltip and legend are all
        // holder-signed together (premium plots as `+`/up, matching the
        // board's `formatGap(-bps)` convention).
        const bps = -Math.round(parseFloat(r.discount) * 10000);
        points.set(t, bps);
      }
      out[symbols[i]] = [...points.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([time, value]) => ({ time: time as UTCTimestamp, value }));
    }
    return out;
  }, [symbols, s0.data, s1.data, s2.data, s3.data]);

  const isLoading = responses.slice(0, symbols.length).some((r) => r.isLoading);
  const totalPoints = Object.values(seriesData).reduce(
    (a, b) => a + b.length,
    0,
  );

  // Normalize toggle: when on, each series is rebased to start at 0
  // (overlay mode — see relative drift between assets, not absolute spread).
  const [normalized, setNormalized] = useState(false);

  const normalizedData = useMemo<Record<string, Sample[]>>(() => {
    if (!normalized) return seriesData;
    const out: Record<string, Sample[]> = {};
    for (const [sym, points] of Object.entries(seriesData)) {
      if (points.length === 0) {
        out[sym] = points;
        continue;
      }
      const baseValue = points[0].value;
      out[sym] = points.map((p) => ({ time: p.time, value: p.value - baseValue }));
    }
    return out;
  }, [seriesData, normalized]);

  return (
    <ExpandShell
      title="Compare · spread"
      subtitle={`${symbols.join(" · ")} · last ${hours}h`}
      controls={
        <button
          type="button"
          onClick={() => setNormalized((v) => !v)}
          aria-pressed={normalized}
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-200",
            normalized
              ? "border-outline bg-surface-2 text-text"
              : "border-hairline text-text-muted hover:text-text",
          )}
        >
          {normalized ? "Normalized" : "Absolute"}
        </button>
      }
    >
      {({ inModal }) => (
        <ChartSurface
          symbols={symbols}
          seriesData={normalizedData}
          isLoading={isLoading}
          totalPoints={totalPoints}
          height={inModal ? "h-full" : "h-[360px] sm:h-[440px]"}
          preview={preview && !inModal}
          exportKey={exportKey}
          onExportPng={onExportPng}
        />
      )}
    </ExpandShell>
  );
}

interface ChartSurfaceProps {
  symbols: string[];
  seriesData: Record<string, Sample[]>;
  isLoading: boolean;
  totalPoints: number;
  height: string;
  preview: boolean;
  exportKey: number;
  onExportPng?: (dataUrl: string) => void;
}

function ChartSurface({
  symbols,
  seriesData,
  isLoading,
  totalPoints,
  height,
  preview,
  exportKey,
  onExportPng,
}: ChartSurfaceProps) {
  const { containerRef, chart, tokens, aliveRef } = useTvChart();
  const seriesMapRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const zeroLineRef = useRef<IPriceLine | null>(null);
  const [hoverValues, setHoverValues] = useState<Record<string, number | null>>(
    {},
  );
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    time: number;
    w: number;
    h: number;
  } | null>(null);

  // Reset zero-line + price formatter once the chart is ready.
  useEffect(() => {
    if (!chart || !tokens) return;
    chart.applyOptions({
      localization: {
        priceFormatter: (p: number) =>
          Math.abs(p) >= 500 ? `${(p / 100).toFixed(1)}%` : `${Math.round(p)}`,
        timeFormatter: (t: Time) =>
          new Date((t as number) * 1000).toLocaleString("en", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
      },
    });
  }, [chart, tokens]);

  // Sync series with the current symbols list. We rebuild on every symbol set
  // change because the colors are positional (idx 0 = first color, etc.).
  useEffect(() => {
    if (!chart || !tokens) return;
    // Tear down previous series + zero line.
    for (const s of seriesMapRef.current.values()) chart.removeSeries(s);
    seriesMapRef.current.clear();
    if (zeroLineRef.current) {
      // The zero line lives on the first series; once we removed everything,
      // we'll re-create it on the new first series below.
      zeroLineRef.current = null;
    }

    symbols.forEach((sym, i) => {
      const line = chart.addSeries(LineSeries, {
        color: seriesColor(i),
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
      });
      seriesMapRef.current.set(sym, line);
      if (i === 0) {
        zeroLineRef.current = line.createPriceLine({
          price: 0,
          color: tokens.outline,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: false,
          title: "",
        });
      }
    });

    return () => {
      // If the parent already disposed the chart, skip per-series cleanup.
      if (!aliveRef.current) {
        seriesMapRef.current.clear();
        zeroLineRef.current = null;
        return;
      }
      for (const s of seriesMapRef.current.values()) chart.removeSeries(s);
      seriesMapRef.current.clear();
      zeroLineRef.current = null;
    };
  }, [chart, symbols, aliveRef]);

  useEffect(() => {
    if (!tokens) return;
    for (const [sym, s] of seriesMapRef.current.entries()) {
      const i = symbols.indexOf(sym);
      if (i !== -1) s.applyOptions({ color: seriesColor(i) });
    }
    zeroLineRef.current?.applyOptions({ color: tokens.outline });
  }, [tokens, symbols]);

  // Push data into each series whenever the source changes.
  useEffect(() => {
    if (!chart) return;
    let hasAny = false;
    for (const [sym, s] of seriesMapRef.current.entries()) {
      const rows = seriesData[sym] ?? [];
      s.setData(rows);
      if (rows.length > 0) hasAny = true;
    }
    if (hasAny) chart.timeScale().fitContent();
  }, [chart, seriesData]);

  // Export ONLY when `exportKey` actually advances (a real PNG click), not when
  // the parent's `onExportPng` callback identity changes. `handlePng` on the
  // compare page depends on `selected`, so changing the asset selection minted a
  // new callback ref and re-ran this effect while `exportKey` was still nonzero —
  // silently re-downloading a file. Track the last-handled key so only a genuine
  // increment triggers a download.
  const lastExportKeyRef = useRef(0);
  useEffect(() => {
    if (!chart || preview) return;
    if (exportKey === lastExportKeyRef.current) return;
    lastExportKeyRef.current = exportKey;
    if (exportKey === 0) return; // initial value, not a real export request
    onExportPng?.(chartToPng(chart));
  }, [chart, exportKey, onExportPng, preview]);

  // Crosshair hover — push the value of every series into the legend and
  // surface a floating tooltip next to the cursor (matches the asset chart).
  useEffect(() => {
    if (!chart) return;
    const handler = (param: import("lightweight-charts").MouseEventParams) => {
      if (!param.time || !param.point) {
        setHoverValues({});
        setTooltip(null);
        return;
      }
      const next: Record<string, number | null> = {};
      for (const [sym, s] of seriesMapRef.current.entries()) {
        const d = param.seriesData.get(s) as { value?: number } | undefined;
        next[sym] = d?.value ?? null;
      }
      setHoverValues(next);
      const rect = containerRef.current?.getBoundingClientRect();
      setTooltip({
        x: param.point.x,
        y: param.point.y,
        time: (param.time as number) * 1000,
        w: rect?.width ?? 0,
        h: rect?.height ?? 0,
      });
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [chart, containerRef]);

  // Show the *last* value when not hovering, hover values when hovering.
  const displayed: Record<string, number | null> = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const sym of symbols) {
      const hov = hoverValues[sym];
      if (hov !== undefined && hov !== null) {
        out[sym] = hov;
        continue;
      }
      const rows = seriesData[sym];
      out[sym] = rows && rows.length > 0 ? rows[rows.length - 1].value : null;
    }
    return out;
  }, [symbols, seriesData, hoverValues]);

  return (
    <div
      className={cn(
        "flex flex-col gap-0 w-full border border-hairline",
        height,
      )}
    >
      <div className="relative flex-1 min-h-0">
        <div
          ref={containerRef}
          className={cn("absolute inset-0", preview && "opacity-25")}
          aria-hidden={preview ? true : undefined}
        />
        {tooltip && tokens && !preview && (
          <CompareTooltip
            tooltip={tooltip}
            symbols={symbols}
            tokens={tokens}
            values={hoverValues}
          />
        )}
        {isLoading && totalPoints === 0 && !preview && (
          // Chart-area skeleton — a faintly pulsing panel echoing the real
          // chart's zero price-line, instead of bare centered text.
          <div
            aria-hidden="true"
            className="absolute inset-3 overflow-hidden rounded-[14px]"
          >
            <div className="h-full w-full animate-pulse bg-text/[0.03]" />
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-text/[0.06]" />
          </div>
        )}
        {!isLoading && totalPoints === 0 && !preview && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            No overlapping data in this window
          </div>
        )}
        {preview && (
          <div className="absolute inset-0 bg-canvas/35" aria-hidden />
        )}
      </div>
      <Legend
        symbols={symbols}
        tokens={tokens}
        values={displayed}
        preview={preview}
      />
    </div>
  );
}

function chartToPng(chart: IChartApi): string {
  const canvas = chart.takeScreenshot(true, false);
  return canvas.toDataURL("image/png");
}

function CompareTooltip({
  tooltip,
  symbols,
  tokens: _tokens,
  values,
}: {
  tooltip: { x: number; y: number; time: number; w: number; h: number };
  symbols: string[];
  tokens: TvTokens;
  values: Record<string, number | null>;
}) {
  // Estimate tooltip width so we can flip it leftwards when near the right edge.
  // Each row is ~120px wide; date header similar. Conservative 180px estimate.
  const estW = 180;
  const estH = 24 + symbols.length * 16;
  const flipX = tooltip.x + 12 + estW > tooltip.w;
  const flipY = tooltip.y - estH - 12 < 0;
  const left = flipX ? tooltip.x - estW - 12 : tooltip.x + 12;
  const top = flipY ? tooltip.y + 12 : Math.max(8, tooltip.y - estH - 4);
  return (
    <div
      className="pointer-events-none absolute z-10 border border-hairline bg-canvas/95 px-2 py-1.5 font-mono text-[10px] backdrop-blur-sm"
      style={{ left, top, minWidth: estW }}
    >
      <div className="text-text-muted">
        {new Date(tooltip.time).toLocaleString("en", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>
      <div className="mt-1 flex flex-col gap-0.5">
        {symbols.map((sym, i) => {
          const v = values[sym];
          return (
            <div key={sym} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3 shrink-0"
                style={{ background: seriesColor(i) }}
              />
              <span className="uppercase tracking-[0.06em] text-text-muted">
                {sym}
              </span>
              <span
                className={cn(
                  "ml-auto",
                  v == null ? "text-text" : spreadSignClass(-v),
                )}
              >
                {v == null ? "-" : formatGap(v)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({
  symbols,
  tokens,
  values,
  preview = false,
}: {
  symbols: string[];
  tokens: TvTokens | null;
  values: Record<string, number | null>;
  preview?: boolean;
}) {
  if (symbols.length === 0 || !tokens) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-hairline px-3 py-2 font-mono text-[10px]",
        preview && "opacity-40",
      )}
      aria-hidden={preview ? true : undefined}
    >
      {symbols.map((sym, i) => {
        const color = seriesColor(i);
        const v = values[sym];
        return (
          <div key={sym} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-3"
              style={{ background: color }}
            />
            <span className="uppercase tracking-[0.06em] text-text-muted">
              {sym}
            </span>
            {/* `values` is ALREADY holder-signed (negated once at the single
                entry point above), and spreadSignClass takes the RAW bps — so
                negate back here. The series swatch to the left carries series
                identity, which frees the number to carry its sign. */}
            <span
              className={
                v === null || v === undefined
                  ? "text-text"
                  : spreadSignClass(-v)
              }
            >
              {v === null || v === undefined ? "-" : formatGap(v)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
