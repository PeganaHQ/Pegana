"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReducedMotionGsap } from "@/lib/motion/use-reduced-motion-gsap";
import { getScrollTrigger } from "@/lib/motion/gsap";
import { prepareDrawIn } from "@/lib/motion/prepare-draw-in";
import { displaySymbol } from "@/lib/asset/display-symbol";
import {
  AreaSeries,
  type AutoscaleInfo,
  BaselineSeries,
  CandlestickSeries,
  createSeriesMarkers,
  LineSeries,
  LineStyle,
  type CandlestickData,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type ISeriesPrimitive,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { PillTabs } from "@/components/molecules/pill-tabs";
import { useHistory } from "@/lib/hooks/use-history";
import { formatGap, isPlausibleDiscount, spreadSignClass } from "@/lib/api/format";
import {
  legsAvailable,
  impliedGapBps,
  sourcesDisagree,
} from "@/lib/asset/legs";
import {
  thresholdLineSpecs,
  priceRangeForGuides,
  type ThresholdRole,
} from "@/lib/asset/chart-thresholds";
import { collapseFlaps } from "@/lib/asset/markers";
import {
  BUCKET_RANGE_MS,
  CHART_BUCKET_STORAGE_KEY,
  CHART_BUCKETS,
  scrubHalfWidthSeconds,
  type ChartBucket,
} from "@/lib/asset/chart-bucket";
import type { AlertRow, PegState } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";
import { HelpIcon } from "@/components/atoms/help-icon";
import { useTvChart } from "./tv-chart/use-tv-chart";
import { withAlpha, type TvTokens } from "./tv-chart/theme";
import { ExpandShell } from "./tv-chart/expand-shell";
import { usePersistedMode } from "./tv-chart/use-persisted-mode";
import { createThresholdBands } from "./asset-chart-bands";

// `Bucket` is a local alias for the shared `ChartBucket` type (defined in
// lib/asset/chart-bucket.ts, alongside the bucket-window math the timeline
// pre-check needs without mounting this dynamically-imported module).
type Bucket = ChartBucket;
type ViewMode = "baseline" | "area" | "line" | "candle" | "legs";

export type AssetChartBucket = Bucket;
export type AssetChartMode = ViewMode;

const VIEW_MODES = [
  "baseline",
  "area",
  "line",
  "candle",
  "legs",
] as const satisfies readonly ViewMode[];
const BUCKETS = CHART_BUCKETS;

/** "Legs" plots the two raw USD price legs, which only persist on the raw
 *  table (`discount_1m` has none) — so the view is pinned to the only
 *  raw-backed bucket. Keep in sync with `bucketParams`. */
const RAW_BUCKET: Bucket = "1h";

/** Transition markers within this many seconds of each other collapse into one
 *  (most-severe) marker — de-noises flappy assets. */
const MARKER_DEDUP_GAP_SEC = 300;

/** Candles only make sense when there are enough samples per bucket. We hide
 *  the option for short windows (raw / 1-minute data sliced too thin would
 *  produce O==H==L==C wicks that read like noise). */
function candleAvailable(b: Bucket): boolean {
  return b === "7d" || b === "30d";
}

/** OHLC bucket size in seconds for each long-range window. Chosen so we end
 *  up with roughly 100-200 candles — readable density on both desktop and
 *  mobile widths. */
function candleStepSeconds(b: Bucket): number {
  if (b === "30d") return 4 * 60 * 60; // 4h candles → ≤ 180 over 30d
  return 60 * 60; // 1h candles → ≤ 168 over 7d
}

interface AssetChartProps {
  symbol: string;
  thresholds: { drift_bps: number; depeg_bps: number; critical_bps: number };
  /** LST / stable_yield only trip on the +discount side (ADR-0021); when true
   *  the chart suppresses the misleading premium-side drift/depeg guides. */
  directionSensitive?: boolean;
  /** Asset peg target ("USD" | "SOL" | "EUR" | "BRL"). Gates the "Legs" mode:
   *  the stored legs are USD-denominated and only honest when the peg target
   *  is the dollar itself (see `legsAvailable`). */
  pegTarget?: string;
  alerts?: AlertRow[];
  bucket?: Bucket;
  mode?: ViewMode;
  onBucketChange?: (bucket: Bucket) => void;
  onModeChange?: (mode: ViewMode) => void;
  /** A scrub request to apply once history has loaded — set by the caller
   *  right after switching to this tab from a timeline row click on another
   *  tab (the chart is unmounted there, so it can't be driven imperatively
   *  until it exists). Applied once; `onScrubSettled` fires after the
   *  attempt with the actual outcome (`doScrub`'s return value) — the target
   *  can still fall outside the chart's REAL loaded domain even after the
   *  caller's own pre-check passed (e.g. a short-history asset), so the
   *  caller must not assume success. */
  initialScrub?: { tsSec: number; state?: PegState } | null;
  onScrubSettled?: (ok: boolean) => void;
  /** Fires whenever the chart's OWN "reset view" affordance clears an active
   *  scrub, so a page-level "which timeline row is active" state can stay in
   *  sync without re-implementing the clear itself. */
  onScrubCleared?: () => void;
}

function bucketParams(b: Bucket): {
  bucket: "raw" | "1m";
  from: string;
  limit: number;
} {
  const now = Date.now();
  const ms = BUCKET_RANGE_MS[b];
  return {
    bucket: ms <= BUCKET_RANGE_MS["1h"] ? "raw" : "1m",
    from: new Date(now - ms).toISOString(),
    limit: 2000,
  };
}

/** Imperative handle exposed by `AssetChart` — lets the activity timeline (a
 *  sibling on a different tab) drive the chart's visible range without the
 *  data spine (URL params, bucket/mode state) changing shape. */
export interface AssetChartHandle {
  /** Moves the visible range to a window centered on `tsSec` and drops a
   *  temporary low-alpha marker there, colored by `state`. Returns false
   *  WITHOUT any effect when `tsSec` falls outside the currently loaded
   *  history's time domain — the fetch is never expanded to cover it. */
  scrubTo: (tsSec: number, state?: PegState) => boolean;
  /** Restores the range visible before the most recent successful `scrubTo`
   *  and removes the temporary marker. No-op when not currently scrubbed. */
  clearScrub: () => void;
}

export const AssetChart = forwardRef<AssetChartHandle, AssetChartProps>(
  function AssetChart(
    {
      symbol,
      thresholds,
      directionSensitive = false,
      pegTarget,
      alerts,
      bucket: controlledBucket,
      mode: controlledMode,
      onBucketChange,
      onModeChange,
      initialScrub,
      onScrubSettled,
      onScrubCleared,
    },
    ref,
  ) {
    const chartRootRef = useRef<HTMLDivElement | null>(null);
    const surfaceRef = useRef<AssetChartHandle>(null);
    const [isScrubbed, setIsScrubbed] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        scrubTo: (tsSec, state) =>
          surfaceRef.current?.scrubTo(tsSec, state) ?? false,
        clearScrub: () => surfaceRef.current?.clearScrub(),
      }),
      [],
    );

    const handleResetScrub = () => {
      surfaceRef.current?.clearScrub();
      onScrubCleared?.();
    };

    useReducedMotionGsap((gsap, reduced) => {
      const root = chartRootRef.current;
      if (!root || reduced) return;
      let tween: gsap.core.Tween | null = null;
      let raf: number | null = null;
      (async () => {
        await getScrollTrigger();
        // Wait for any post-mount SVG path injection (Recharts, etc).
        raf = requestAnimationFrame(() => {
          const paths = root.querySelectorAll<SVGPathElement>("svg path");
          if (paths.length === 0) return;
          prepareDrawIn(paths);
          tween = gsap.to(paths, {
            strokeDashoffset: 0,
            duration: 1.8,
            ease: "power2.out",
            scrollTrigger: {
              trigger: root,
              start: "top 80%",
              toggleActions: "play none none none",
            },
          });
        });
      })();
      return () => {
        if (raf != null) cancelAnimationFrame(raf);
        tween?.kill();
      };
    }, []);

    const [storedBucket, setStoredBucket] = usePersistedMode<Bucket>(
      CHART_BUCKET_STORAGE_KEY,
      "24h",
      BUCKETS,
    );
    const [storedMode, setStoredMode] = usePersistedMode<ViewMode>(
      "pegana.assetChart.mode.v1",
      "baseline",
      VIEW_MODES,
    );
    const bucket = controlledBucket ?? storedBucket;
    const mode = controlledMode ?? storedMode;
    const legsOk = legsAvailable(pegTarget);

    const setMode = (next: ViewMode) => {
      setStoredMode(next);
      onModeChange?.(next);
      // Legs only exist on the raw-backed bucket; entering legs from a longer
      // window pins it to that bucket so the view has data to plot.
      if (next === "legs" && bucket !== RAW_BUCKET) {
        setStoredBucket(RAW_BUCKET);
        onBucketChange?.(RAW_BUCKET);
      }
    };

    // Switching to a bucket a mode can't render falls the mode back to baseline
    // so the chart stays informative: candle needs enough samples per bucket;
    // legs need the raw-backed bucket (the 1m aggregate stores no legs).
    const setBucket = (b: Bucket) => {
      if (mode === "candle" && !candleAvailable(b)) setMode("baseline");
      if (mode === "legs" && b !== RAW_BUCKET) setMode("baseline");
      setStoredBucket(b);
      onBucketChange?.(b);
    };

    const effectiveMode: ViewMode =
      mode === "candle" && !candleAvailable(bucket)
        ? "baseline"
        : mode === "legs" && (!legsOk || bucket !== RAW_BUCKET)
          ? "baseline"
          : mode;

    const params = useMemo(() => bucketParams(bucket), [bucket]);
    const { data, isLoading } = useHistory(symbol, params);

    // The API returns rows newest-first and may have duplicate seconds; LWC
    // requires strictly ascending unique timestamps. Bucket to the second,
    // dedupe by time (last write wins), then sort ASC. Drop physically-
    // impossible samples (|discount| > 1.0) — a single bad sample wrecks the
    // auto-scaled Y-axis.
    const chartData = useMemo(() => {
      if (!data) return [];
      // Smoothed bps per timestamp; we treat duplicates as "last write wins"
      // because LWC needs strictly ascending unique times.
      const smoothed = new Map<number, number>();
      const raw = new Map<number, number>();
      const legs = new Map<number, { market: number; intrinsic: number }>();
      // Third independent USD source (Pyth oracle) — honest-gated server-side
      // (see HistoryPoint.oracle_usd), so its presence is per-point and
      // independent of the market/intrinsic pair above; never defaulted.
      const oracleLeg = new Map<number, number>();
      for (const p of data) {
        if (!isPlausibleDiscount(p.discount)) continue;
        const t = Math.floor(new Date(p.ts).getTime() / 1000);
        // Plot in the HOLDER convention (premium = +, ABOVE the peg line;
        // discount = −, below), so the chart agrees with the hero, the rail and
        // every readout on the site. The API `discount` is 1 − market/intrinsic
        // (premium-NEGATIVE), so negate it here — the ONE place the series enters
        // the chart. `formatGap(value)` on the negated series then prints the
        // holder sign automatically, and the threshold guides/bands flip with it
        // (thresholdLineSpecs + bandSpecs now emit the discount/risk band on the
        // − side for direction-sensitive classes). QA audit 2026-07-23.
        smoothed.set(t, -Math.round(parseFloat(p.discount) * 10000));
        if (p.discount_raw && isPlausibleDiscount(p.discount_raw)) {
          raw.set(t, -Math.round(parseFloat(p.discount_raw) * 10000));
        }
        // Raw USD legs (raw bucket only). BOTH must be finite AND strictly
        // positive — a zeroed/garbage market or NAV print is dropped (leaving a
        // gap the chart interpolates) rather than plotting a spurious line to 0,
        // consistent with the oracle leg's own `> 0` guard below.
        if (p.intrinsic_usd != null && p.market_usd != null) {
          const intrinsic = parseFloat(p.intrinsic_usd);
          const market = parseFloat(p.market_usd);
          if (
            Number.isFinite(intrinsic) &&
            Number.isFinite(market) &&
            intrinsic > 0 &&
            market > 0
          ) {
            legs.set(t, { market, intrinsic });
          }
        }
        if (p.oracle_usd != null) {
          const oracle = parseFloat(p.oracle_usd);
          // `> 0`, matching the intrinsic/market pair above — a zeroed/garbage
          // oracle print must NOT manufacture a false "sources disagree" (the
          // JupUSD zero-price-EWMA false-CRITICAL class).
          if (Number.isFinite(oracle) && oracle > 0) {
            oracleLeg.set(t, oracle);
          }
        }
      }
      return [...smoothed.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([time, value]) => ({
          time: time as UTCTimestamp,
          value,
          raw: raw.has(time) ? raw.get(time)! : null,
          market: legs.get(time)?.market ?? null,
          intrinsic: legs.get(time)?.intrinsic ?? null,
          oracle: oracleLeg.has(time) ? oracleLeg.get(time)! : null,
        }));
    }, [data]);

    const latest = chartData[chartData.length - 1];
    // The "now:" readout follows the site-wide sign rule (premium green,
    // discount red) like every other spread number. It used to key off
    // |value| against the threshold bands — a fourth colouring scheme for the
    // same quantity. The chart's own guides/bands keep their band colours;
    // this is only the text readout.
    //
    // `latest.value` is already HOLDER-signed (negated once at line ~303 where
    // the series enters), while spreadSignClass takes the RAW convention — so
    // negate to cross back.
    const latestColor = latest
      ? spreadSignClass(-latest.value)
      : "text-text-muted";

    return (
      <section
        ref={chartRootRef}
        className="-mx-5 px-0 py-8 sm:mx-0 sm:px-8 sm:py-12"
      >
        <Header
          bucket={bucket}
          onBucket={setBucket}
          mode={effectiveMode}
          onMode={setMode}
          candleEnabled={candleAvailable(bucket)}
          legsEnabled={legsOk}
          latest={latest?.value ?? null}
          latestColorClass={latestColor}
          isScrubbed={isScrubbed}
          onResetScrub={handleResetScrub}
        />
        <ExpandShell
          title={`${displaySymbol(symbol)} · spread`}
          subtitle={`${bucket} · ${labelForMode(effectiveMode)}`}
        >
          {({ inModal }) => (
            <ChartSurface
              ref={inModal ? undefined : surfaceRef}
              data={chartData}
              mode={effectiveMode}
              thresholds={thresholds}
              directionSensitive={directionSensitive}
              bucket={bucket}
              isLoading={isLoading}
              height={inModal ? "h-full" : "h-[280px] sm:h-[320px]"}
              alerts={alerts}
              initialScrub={inModal ? undefined : initialScrub}
              onScrubSettled={inModal ? undefined : onScrubSettled}
              onScrubStateChange={inModal ? undefined : setIsScrubbed}
              onScrubCleared={inModal ? undefined : onScrubCleared}
            />
          )}
        </ExpandShell>
      </section>
    );
  },
);

function Header({
  bucket,
  onBucket,
  mode,
  onMode,
  candleEnabled,
  legsEnabled,
  latest,
  latestColorClass,
  isScrubbed,
  onResetScrub,
}: {
  bucket: Bucket;
  onBucket: (b: Bucket) => void;
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
  candleEnabled: boolean;
  legsEnabled: boolean;
  latest: number | null;
  latestColorClass: string;
  isScrubbed: boolean;
  onResetScrub: () => void;
}) {
  const modeOptions: Array<{ v: ViewMode; label: string; disabled?: boolean }> =
    [
      { v: "baseline", label: "baseline" },
      { v: "area", label: "area" },
      { v: "line", label: "line" },
      { v: "candle", label: "candle", disabled: !candleEnabled },
      // Legs: market vs intrinsic. Only honest for USD-peg assets, so it is
      // hidden (disabled) for SOL/EUR/BRL-peg assets where the USD legs swing
      // with the oracle multiplier rather than the real peg.
      { v: "legs", label: "legs", disabled: !legsEnabled },
    ];
  return (
    <div className="mb-4 flex flex-col gap-3 px-5 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <h2 className="inline-flex items-center font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            Spread · market vs intrinsic
            <HelpIcon term="spread" size="xs" />
          </h2>
          {latest !== null && (
            <span className="font-mono text-[11px] text-text">
              now: <span className={latestColorClass}>{formatGap(latest)}</span>
            </span>
          )}
          {/* Scrub reset affordance — only present while a timeline row has
              scrubbed the visible range (see AssetChart's imperative handle).
              Dim mono, never the iridescent gradient. */}
          {isScrubbed && (
            <button
              type="button"
              onClick={onResetScrub}
              className="inline-flex items-center gap-1 rounded-full border border-outline px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted transition-colors duration-200 hover:border-text hover:text-text"
            >
              Scrubbed view <span aria-hidden>·</span> Reset
            </button>
          )}
        </div>
        <SegmentedButtons
          value={bucket}
          options={["1h", "24h", "7d", "30d"]}
          onChange={onBucket}
        />
      </div>
      {/* View-mode row (baseline/area/line/candle) is desktop-only — phones get
          the baseline default; 8 tiny controls in two rows was too dense.
          Adopts the shared PillTabs (FLIP-spring indicator) — unlike the
          bucket/range switcher below, this row has no mobile full-width
          touch-target requirement (it's already sm-only), so it fits the
          generic API cleanly (see w3r3 PillTabs report for why the bucket
          switcher was NOT migrated). */}
      <div className="hidden justify-start sm:flex sm:justify-end">
        <PillTabs
          items={modeOptions.map((o) => ({
            key: o.v,
            label: o.label,
            disabled: o.disabled,
          }))}
          value={mode}
          onChange={onMode}
          ariaLabel="Chart view mode"
        />
      </div>
    </div>
  );
}

/** V5 pill-tab mini variant (the /assets class-filter language, compact) —
 *  one rounded-full track, active option solid bg-text/text-canvas, no
 *  per-option border. Used for both the range and mode switchers. */
function SegmentedButtons<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<T | { v: T; label: string; disabled?: boolean }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-full border border-hairline p-1">
      {options.map((opt) => {
        const v = typeof opt === "string" ? opt : opt.v;
        const label = typeof opt === "string" ? opt : opt.label;
        const disabled =
          typeof opt === "string" ? false : opt.disabled === true;
        const active = v === value && !disabled;
        return (
          <button
            key={v}
            type="button"
            onClick={() => !disabled && onChange(v)}
            disabled={disabled}
            aria-pressed={active}
            className={cn(
              "inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full px-3.5 py-1 font-mono text-[11px] uppercase tracking-[0.04em] transition-colors duration-200 sm:min-h-0 sm:flex-none sm:px-3",
              active && "bg-text text-canvas",
              !active && !disabled && "text-text-muted hover:text-text",
              disabled && "cursor-not-allowed text-text-muted/40",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function labelForMode(m: ViewMode): string {
  return m;
}

interface ChartSurfaceProps {
  data: Array<{
    time: UTCTimestamp;
    value: number;
    raw: number | null;
    market: number | null;
    intrinsic: number | null;
    oracle: number | null;
  }>;
  mode: ViewMode;
  thresholds: { drift_bps: number; depeg_bps: number; critical_bps: number };
  directionSensitive: boolean;
  bucket: Bucket;
  isLoading: boolean;
  height: string;
  alerts?: AlertRow[];
  initialScrub?: { tsSec: number; state?: PegState } | null;
  onScrubSettled?: (ok: boolean) => void;
  onScrubStateChange?: (active: boolean) => void;
  /** Fires whenever a scrub is cleared for any reason — the explicit reset
   *  affordance (handled one level up, in `AssetChart`) OR this component's
   *  own auto-clear when `bucket`/`mode` changes out from under an active
   *  scrub. Lets a page-level "which timeline row is active" state stay in
   *  sync without re-implementing the clear logic itself. */
  onScrubCleared?: () => void;
}

const ChartSurface = forwardRef<AssetChartHandle, ChartSurfaceProps>(
  function ChartSurface(
    {
      data,
      mode,
      thresholds,
      directionSensitive,
      bucket,
      isLoading,
      height,
      alerts,
      initialScrub,
      onScrubSettled,
      onScrubStateChange,
      onScrubCleared,
    },
    ref,
  ) {
    const { containerRef, chart, tokens, aliveRef } = useTvChart();
    const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
    // Second muted LineSeries that draws `discount_raw` underneath the
    // smoothed line. Only attached for non-candle modes (raw OHLC would be
    // meaningless). Renders behind the main series so the smoothed line stays
    // visually dominant.
    const rawSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    // Third "Legs" line — the Pyth oracle leg. Only ever created/attached
    // inside the `mode === "legs"` branch below (unlike rawSeriesRef, which
    // is dual-purpose: the raw-discount overlay outside legs mode too), so
    // it needs no counterpart handling in the non-legs cleanup branch.
    const oracleSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const priceLinesRef = useRef<IPriceLine[]>([]);
    // FILLED drift/depeg/critical background bands, drawn behind (zOrder
    // "bottom") the dashed threshold lines above — same thresholds + same
    // directionSensitive value, kept in lockstep with priceLinesRef so the
    // two never disagree (see asset-chart-bands.ts).
    const bandsRef = useRef<ISeriesPrimitive<Time> | null>(null);
    const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    // Current symmetric y-range (bps) for the autoscaleInfoProvider — recomputed
    // from the data each render so the dashed guides don't force the axis open to
    // ±critical. Read by the provider closure set on the series at build time.
    const scaleRangeRef = useRef<{ minValue: number; maxValue: number } | null>(
      null,
    );
    const tooltipRef = useRef<HTMLDivElement | null>(null);
    const [tooltip, setTooltip] = useState<{
      x: number;
      y: number;
      time: number;
      value: number;
      raw: number | null;
      oracle: number | null;
    } | null>(null);

    // Timeline-scrub state. `scrubTarget` is state (not a ref) so both the
    // marker effect and the reset affordance re-render on every scrub, even a
    // second scrub to a different row while already scrubbed. `scrubStateRef`
    // holds the ONE range to restore to — captured only on the transition into
    // "scrubbed", so scrubbing to a second row still restores the ORIGINAL view.
    const [scrubTarget, setScrubTarget] = useState<{
      tsSec: number;
      state: PegState;
    } | null>(null);
    const scrubStateRef = useRef<{
      prevRange: { from: Time; to: Time } | null;
    } | null>(null);

    const doScrub = (tsSec: number, state: PegState = "UNKNOWN"): boolean => {
      if (!chart || !seriesRef.current || data.length === 0) return false;
      const minSec = data[0].time as number;
      const maxSec = data[data.length - 1].time as number;
      if (tsSec < minSec || tsSec > maxSec) return false;
      if (!scrubStateRef.current) {
        scrubStateRef.current = {
          prevRange: chart.timeScale().getVisibleRange(),
        };
      }
      const half = scrubHalfWidthSeconds(bucket);
      const from = Math.max(minSec, tsSec - half);
      const to = Math.min(maxSec, tsSec + half);
      chart.timeScale().setVisibleRange({ from: from as Time, to: to as Time });
      setScrubTarget({ tsSec, state });
      return true;
    };

    const doClearScrub = () => {
      if (chart) {
        const prev = scrubStateRef.current?.prevRange;
        if (prev) chart.timeScale().setVisibleRange(prev);
        else chart.timeScale().fitContent();
      }
      scrubStateRef.current = null;
      setScrubTarget(null);
    };

    useImperativeHandle(
      ref,
      () => ({
        scrubTo: (tsSec, state) => doScrub(tsSec, state),
        clearScrub: () => doClearScrub(),
      }),
      [chart, data, bucket],
    );

    // Apply a scrub request handed down from a tab switch (the timeline row
    // that triggered it lives on History; the chart only exists once we're on
    // Overview). Waits for history to load, applies once, then reports back so
    // the caller can clear its pending state — never retried after that.
    const appliedInitialScrubRef = useRef(false);
    useEffect(() => {
      if (!initialScrub || appliedInitialScrubRef.current) return;
      if (data.length === 0) return;
      appliedInitialScrubRef.current = true;
      // `doScrub` validates against the REAL loaded domain (data[0]..data[last]),
      // which can be narrower than the caller's own pre-check (e.g. a
      // short-history asset) — report the actual outcome so the caller never
      // asserts a scrub that didn't happen.
      const ok = doScrub(initialScrub.tsSec, initialScrub.state ?? "UNKNOWN");
      onScrubSettled?.(ok);
    }, [initialScrub, data]);

    useEffect(() => {
      onScrubStateChange?.(scrubTarget != null);
    }, [scrubTarget, onScrubStateChange]);

    // A bucket or mode switch loads an entirely different series. An active
    // scrub's marker/window belong to the PREVIOUS series — re-anchoring them
    // here would snap a stale timestamp onto data it never occurred in (a
    // marker planted at a time the event did not happen) and the fitContent
    // guards below would leave the view frozen on the old scrub window. Clear
    // immediately (no prevRange restore — the data-push effect's fitContent
    // reframes the freshly-loaded series once scrubTarget is null) and notify
    // the caller so a page-level "active timeline row" indicator doesn't go
    // stale too. Deliberately NOT keyed on `scrubTarget` itself — only a real
    // bucket/mode change should trigger this.
    useEffect(() => {
      if (!scrubTarget) return;
      scrubStateRef.current = null;
      setScrubTarget(null);
      onScrubCleared?.();
    }, [bucket, mode]);

    // Create / recreate the series whenever the view mode changes. For
    // non-candle modes we attach a second muted LineSeries that draws the
    // raw discount sample so the methodology story is visible: "smoothed
    // crossed the threshold; raw was bouncing around it".
    useEffect(() => {
      if (!chart || !tokens) return;

      // Legs mode: two raw USD price lines (market + intrinsic/NAV) on the
      // default auto-scaled right scale — NO bps threshold lines. Reuse the
      // primary/raw refs: seriesRef = market (markers + tooltip anchor),
      // rawSeriesRef = intrinsic.
      if (mode === "legs") {
        const market = chart.addSeries(
          LineSeries,
          legsSeriesThemeOptions("market", tokens),
        );
        const intrinsic = chart.addSeries(
          LineSeries,
          legsSeriesThemeOptions("intrinsic", tokens),
        );
        const oracle = chart.addSeries(
          LineSeries,
          legsSeriesThemeOptions("oracle", tokens),
        );
        seriesRef.current = market;
        rawSeriesRef.current = intrinsic;
        oracleSeriesRef.current = oracle;
        return () => {
          if (!aliveRef.current) {
            seriesRef.current = null;
            rawSeriesRef.current = null;
            oracleSeriesRef.current = null;
            markersRef.current = null;
            return;
          }
          markersRef.current?.setMarkers([]);
          markersRef.current = null;
          chart.removeSeries(market);
          chart.removeSeries(intrinsic);
          chart.removeSeries(oracle);
          seriesRef.current = null;
          rawSeriesRef.current = null;
          oracleSeriesRef.current = null;
        };
      }

      const s = buildSeries(chart, mode, tokens);
      seriesRef.current = s;
      // Drive autoscale from the data + depeg band (see priceRangeForGuides) so
      // the symmetric ±critical guide lines don't open the axis to ±critical and
      // flatten the live trace for wide-band assets. Falls back to LWC's default
      // when no range is computed yet.
      s.applyOptions({
        autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
          const r = scaleRangeRef.current;
          return r ? { priceRange: r } : base();
        },
      });
      priceLinesRef.current = addThresholdLines(
        s,
        thresholds,
        tokens,
        directionSensitive,
      );
      // Filled bands behind the dashed lines just created above — SAME
      // thresholds + directionSensitive, so the shading never disagrees with
      // where those guides sit.
      const bands = createThresholdBands({
        driftBps: thresholds.drift_bps,
        depegBps: thresholds.depeg_bps,
        criticalBps: thresholds.critical_bps,
        directionSensitive,
      });
      s.attachPrimitive(bands);
      bandsRef.current = bands;
      let rawSeries: ISeriesApi<"Line"> | null = null;
      if (mode !== "candle") {
        rawSeries = chart.addSeries(LineSeries, rawSeriesThemeOptions(tokens));
        rawSeriesRef.current = rawSeries;
      }
      return () => {
        // If the parent already disposed the chart, LWC has cleared the series.
        if (!aliveRef.current) {
          priceLinesRef.current = [];
          bandsRef.current = null;
          seriesRef.current = null;
          rawSeriesRef.current = null;
          return;
        }
        priceLinesRef.current.forEach((l) => s.removePriceLine(l));
        priceLinesRef.current = [];
        if (bandsRef.current) {
          s.detachPrimitive(bandsRef.current);
          bandsRef.current = null;
        }
        markersRef.current?.setMarkers([]);
        markersRef.current = null;
        chart.removeSeries(s);
        seriesRef.current = null;
        if (rawSeries) {
          chart.removeSeries(rawSeries);
          rawSeriesRef.current = null;
        }
      };
    }, [
      chart,
      mode,
      thresholds.drift_bps,
      thresholds.depeg_bps,
      thresholds.critical_bps,
      directionSensitive,
      aliveRef,
    ]);

    useEffect(() => {
      const s = seriesRef.current;
      if (!s || !tokens) return;
      if (mode === "legs") {
        s.applyOptions(legsSeriesThemeOptions("market", tokens));
        rawSeriesRef.current?.applyOptions(
          legsSeriesThemeOptions("intrinsic", tokens),
        );
        oracleSeriesRef.current?.applyOptions(
          legsSeriesThemeOptions("oracle", tokens),
        );
        return;
      }
      applySeriesTheme(s, mode, tokens);
      applyThresholdLineTheme(
        priceLinesRef.current,
        thresholds,
        tokens,
        directionSensitive,
      );
    }, [
      tokens,
      mode,
      thresholds.drift_bps,
      thresholds.depeg_bps,
      thresholds.critical_bps,
      directionSensitive,
    ]);

    // Push data into the current series, transforming to OHLC when in candle
    // mode. The aggregation is cheap (single linear pass) so we run it inline.
    useEffect(() => {
      const s = seriesRef.current;
      if (!s) return;
      if (mode === "legs") {
        // Market → primary series, intrinsic/NAV → the second (raw) ref. Both
        // carry raw USD values; missing legs (1m buckets) drop out.
        const market = data
          .filter((d) => d.market !== null)
          .map((d) => ({ time: d.time, value: d.market as number }));
        s.setData(market);
        const intrinsicPts = data
          .filter((d) => d.intrinsic !== null)
          .map((d) => ({ time: d.time, value: d.intrinsic as number }));
        rawSeriesRef.current?.setData(intrinsicPts);
        // Oracle leg is honest-gated server-side and often sparser than
        // market/intrinsic — filter to present points only. An empty result
        // (asset has no subscribed/independent oracle reading in this
        // window) still calls setData([]), which renders no line — no
        // separate "remove the series" branch needed.
        const oraclePts = data
          .filter((d) => d.oracle !== null)
          .map((d) => ({ time: d.time, value: d.oracle as number }));
        oracleSeriesRef.current?.setData(oraclePts);
        // Skip fitContent while a timeline scrub is active — otherwise the next
        // history poll would silently snap the view back to full range.
        if (market.length > 0 && !scrubTarget) chart?.timeScale().fitContent();
        return;
      }
      // Frame the y-axis to the data + depeg band so the ±critical guides don't
      // squash the line (see priceRangeForGuides). Set BEFORE setData so the
      // autoscaleInfoProvider reads the fresh range on the redraw setData triggers.
      scaleRangeRef.current = priceRangeForGuides(
        data.map((d) => d.value),
        thresholds.depeg_bps,
      );
      if (mode === "candle") {
        const candles = aggregateCandles(
          data.map((d) => ({ time: d.time, value: d.value })),
          candleStepSeconds(bucket),
        );
        (s as ISeriesApi<"Candlestick">).setData(candles);
      } else {
        s.setData(data.map(({ time, value }) => ({ time, value })));
      }
      // Push raw line if attached and at least one point has raw data.
      const rs = rawSeriesRef.current;
      if (rs && mode !== "candle") {
        const rawPts = data
          .filter((d) => d.raw !== null)
          .map((d) => ({ time: d.time, value: d.raw as number }));
        rs.setData(rawPts);
      }
      // Skip fitContent while a timeline scrub is active — otherwise the next
      // history poll would silently snap the view back to full range.
      if (data.length > 0 && !scrubTarget) chart?.timeScale().fitContent();
    }, [data, chart, mode, bucket, thresholds.depeg_bps, scrubTarget]);

    useEffect(() => {
      const s = seriesRef.current;
      if (!s || !tokens) return;
      const base = transitionMarkers(alerts, data, tokens);
      // The scrub marker is a temporary, low-alpha instant marker — merged into
      // the same plugin instance (rather than a second one) so it naturally
      // survives/refreshes alongside every history poll without extra
      // lifecycle wiring, and disappears the moment scrubTarget clears.
      const scrubMarker = scrubTarget
        ? scrubMarkerFor(scrubTarget, data, tokens)
        : null;
      const markers = scrubMarker
        ? [...base, scrubMarker].sort(
            (a, b) => (a.time as number) - (b.time as number),
          )
        : base;
      if (!markersRef.current) {
        markersRef.current = createSeriesMarkers(s, markers, { zOrder: "top" });
        return;
      }
      markersRef.current.setMarkers(markers);
      // `mode` is a dependency so the markers re-attach to the freshly built
      // series after any mode switch (the build effect nulls markersRef on
      // teardown); without it a switch would silently drop the transition
      // arrows until the next data/alerts change.
    }, [alerts, data, tokens, mode, scrubTarget]);

    // Configure time-axis tick format based on the current bucket window.
    useEffect(() => {
      if (!chart) return;
      chart.applyOptions({
        timeScale: {
          tickMarkFormatter: (t: Time) => {
            const ms = (t as number) * 1000;
            const d = new Date(ms);
            if (bucket === "7d" || bucket === "30d") {
              return d.toLocaleDateString("en", {
                month: "short",
                day: "numeric",
              });
            }
            return d.toLocaleTimeString("en", {
              hour: "2-digit",
              minute: "2-digit",
            });
          },
        },
        localization: {
          // Legs mode plots USD price legs (~$1), so the axis is dollars; every
          // other mode plots the signed discount in bps.
          priceFormatter: (p: number) => {
            if (mode === "legs") return `$${p.toFixed(4)}`;
            if (Math.abs(p) >= 500) return `${(p / 100).toFixed(1)}%`;
            return `${Math.round(p)}`;
          },
          timeFormatter: (t: Time) =>
            new Date((t as number) * 1000).toLocaleString("en", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
        },
      });
    }, [chart, bucket, mode]);

    // Custom mono tooltip on crosshair move. Shows the smoothed value
    // prominently; if a raw sample is available at the same timestamp,
    // includes it on a second line for the methodology story.
    useEffect(() => {
      if (!chart) return;
      const handler = (
        param: import("lightweight-charts").MouseEventParams,
      ) => {
        const s = seriesRef.current;
        if (!s || !param.time || !param.point) {
          setTooltip(null);
          return;
        }
        const d = param.seriesData.get(s) as
          { value?: number; close?: number } | undefined;
        const value = d?.value ?? d?.close;
        if (value === undefined) {
          setTooltip(null);
          return;
        }
        const rs = rawSeriesRef.current;
        const rawAt = rs
          ? ((param.seriesData.get(rs) as { value?: number } | undefined)
              ?.value ?? null)
          : null;
        const os = oracleSeriesRef.current;
        const oracleAt = os
          ? ((param.seriesData.get(os) as { value?: number } | undefined)
              ?.value ?? null)
          : null;
        setTooltip({
          x: param.point.x,
          y: param.point.y,
          time: (param.time as number) * 1000,
          value,
          raw: rawAt,
          oracle: oracleAt,
        });
      };
      chart.subscribeCrosshairMove(handler);
      return () => chart.unsubscribeCrosshairMove(handler);
    }, [chart]);

    // Clear any crosshair tooltip on a mode change so a bps reading from the
    // previous mode never renders under the legs (USD) branch — or vice versa —
    // until the next crosshair move refreshes it.
    useEffect(() => {
      setTooltip(null);
    }, [mode]);

    // Legs mode plots d.market/d.intrinsic, which can be empty even when bps
    // points exist — e.g. the brief window after a deploy where the API has not
    // yet started returning legs on /history. Treat that as its own empty state
    // rather than rendering a blank plot under the Market/Intrinsic legend.
    const legsEmpty =
      mode === "legs" &&
      data.length > 0 &&
      !data.some((d) => d.market !== null);

    // Third-leg (Pyth oracle) presence gates the "Oracle · Pyth" chip +
    // the magenta leg — honest-gated server-side (HistoryPoint.oracle_usd), so
    // it can legitimately be absent for a whole window (asset not subscribed /
    // not independent of the DEX quote), never defaulted. (The divergence
    // verdict itself is the hero amber OracleDegradedBadge, ADR-0035.)
    // The magenta Pyth-oracle leg is shown when present; the current-status
    // market↔oracle divergence VERDICT lives in ONE place — the hero amber
    // OracleDegradedBadge (ADR-0035) — not as a second red/green legend chip
    // (removed 2026-07-17: three-color-for-one-fact clash, launch-readiness audit).
    const hasOracle = mode === "legs" && data.some((d) => d.oracle !== null);

    return (
      <div
        className={cn("relative w-full border border-hairline", height)}
        style={{ background: "var(--color-chart-canvas)" }}
      >
        <div ref={containerRef} className="absolute inset-0" />
        {!isLoading && data.length > 0 && !legsEmpty && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap gap-1 font-mono text-[9px] uppercase tracking-[0.08em] text-text-caption">
            {mode === "legs" ? (
              <>
                <span className="border border-st-drift/40 bg-canvas/80 px-1.5 py-0.5 text-st-drift">
                  Market
                </span>
                <span className="border border-hairline bg-canvas/80 px-1.5 py-0.5 text-text-muted">
                  Intrinsic · NAV
                </span>
                {hasOracle && (
                  <span className="border border-magenta/40 bg-canvas/80 px-1.5 py-0.5 text-magenta">
                    Oracle · Pyth
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="border border-hairline bg-canvas/80 px-1.5 py-0.5">
                  Peg 0
                </span>
                <span className="border border-st-drift/40 bg-canvas/80 px-1.5 py-0.5 text-st-drift">
                  Drift region
                </span>
                <span className="border border-st-depeg/40 bg-canvas/80 px-1.5 py-0.5 text-st-depeg-text">
                  Depeg region
                </span>
              </>
            )}
          </div>
        )}
        {tooltip && (
          <div
            ref={tooltipRef}
            className="pointer-events-none absolute z-10 border border-hairline bg-canvas/95 px-2 py-1.5 font-mono text-[10px] backdrop-blur-sm"
            style={tooltipPosition(tooltip)}
          >
            <div className="text-text-muted">
              {new Date(tooltip.time).toLocaleString("en", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            {mode === "legs" ? (
              <LegsTooltipBody
                market={tooltip.value}
                intrinsic={tooltip.raw}
                oracle={tooltip.oracle}
              />
            ) : (
              <>
                <div className="mt-0.5 text-text">
                  smoothed{" "}
                  <span className="text-text">{formatGap(tooltip.value)}</span>
                </div>
                {tooltip.raw !== null && (
                  <div className="text-text-muted">
                    raw <span>{formatGap(tooltip.raw)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {isLoading && data.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="sr-only">Loading history</span>
            <div className="h-full w-full max-w-[320px] animate-pulse space-y-3" aria-hidden>
              <div className="h-4 w-3/4 rounded-full bg-surface-2" />
              <div className="h-32 w-full rounded-[8px] bg-surface-2" />
              <div className="h-4 w-1/2 rounded-full bg-surface-2" />
            </div>
          </div>
        )}
        {!isLoading && data.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            No data in this range
          </div>
        )}
        {!isLoading && legsEmpty && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            No leg data in this range
          </div>
        )}
      </div>
    );
  },
);

/** Snaps a scrub target to the nearest EXISTING bar (lightweight-charts only
 *  renders a marker when its time matches a real data point) and colors it by
 *  the alert's to_state at low alpha — dim mono signal, never the iridescent
 *  gradient. */
function scrubMarkerFor(
  target: { tsSec: number; state: PegState },
  data: Array<{ time: UTCTimestamp }>,
  tokens: TvTokens,
): SeriesMarker<Time> | null {
  if (data.length === 0) return null;
  let nearest = data[0].time as number;
  let bestDelta = Math.abs(nearest - target.tsSec);
  for (const d of data) {
    const delta = Math.abs((d.time as number) - target.tsSec);
    if (delta < bestDelta) {
      bestDelta = delta;
      nearest = d.time as number;
    }
  }
  return {
    id: "scrub-target",
    time: nearest as UTCTimestamp,
    position: "inBar",
    shape: "circle",
    color: withAlpha(markerColor(target.state, tokens), 0.55),
    size: 1.6,
  };
}

function transitionMarkers(
  alerts: AlertRow[] | undefined,
  data: Array<{ time: UTCTimestamp; value: number }>,
  tokens: TvTokens,
): SeriesMarker<Time>[] {
  if (!alerts?.length || data.length === 0) return [];
  const min = data[0].time as number;
  const max = data[data.length - 1].time as number;
  const seeds = alerts
    .map((a) => ({
      alert: a,
      time: Math.floor(new Date(a.detected_at).getTime() / 1000),
      state: a.to_state,
    }))
    .filter((x) => Number.isFinite(x.time) && x.time >= min && x.time <= max)
    .sort((a, b) => a.time - b.time);
  // Collapse rapid flapping (e.g. hyUSD's PEGGED↔DRIFT churn) into one
  // most-severe marker per burst before the 24-cap, so the cap counts distinct
  // events rather than flap noise.
  return collapseFlaps(seeds, MARKER_DEDUP_GAP_SEC)
    .slice(-24)
    .map(({ alert, time }) => {
      const to = alert.to_state;
      return {
        id: alert.id,
        time: time as UTCTimestamp,
        position: to === "PEGGED" ? "belowBar" : "aboveBar",
        shape: to === "PEGGED" ? "arrowUp" : "arrowDown",
        color: markerColor(to, tokens),
        text: to.replace("_", " "),
        size: 1.25,
      };
    });
}

function markerColor(state: PegState, tokens: TvTokens): string {
  if (state === "PEGGED") return tokens.stPegged;
  if (state === "DRIFT") return tokens.stDrift;
  if (state === "DEPEG") return tokens.stDepeg;
  if (state === "CRITICAL" || state === "BLACK_SWAN") return tokens.stCritical;
  return tokens.textMuted;
}

function tooltipPosition(t: { x: number; y: number }) {
  // Offset slightly so the tooltip doesn't sit under the cursor crosshair.
  const x = t.x + 12;
  const y = Math.max(8, t.y - 36);
  return { left: x, top: y };
}

function buildSeries(
  chart: import("lightweight-charts").IChartApi,
  mode: ViewMode,
  t: TvTokens,
): ISeriesApi<SeriesType> {
  if (mode === "baseline") {
    return chart.addSeries(BaselineSeries, seriesThemeOptions(mode, t));
  }
  if (mode === "area") {
    return chart.addSeries(AreaSeries, seriesThemeOptions(mode, t));
  }
  if (mode === "candle") {
    return chart.addSeries(CandlestickSeries, seriesThemeOptions(mode, t));
  }
  return chart.addSeries(LineSeries, seriesThemeOptions(mode, t));
}

function applySeriesTheme(
  s: ISeriesApi<SeriesType>,
  mode: ViewMode,
  t: TvTokens,
) {
  s.applyOptions(seriesThemeOptions(mode, t));
}

/**
 * Theme for the raw-discount overlay line. Dimmer than the smoothed series
 * (uses textCaption + reduced line width) so the smoothed line stays
 * visually dominant — the smoothed value is what the FSM acts on; the raw
 * is just methodology context.
 */
function rawSeriesThemeOptions(t: TvTokens) {
  return {
    color: withAlpha(t.textMuted, 0.4),
    lineWidth: 1 as const,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  };
}

/**
 * Theme for the three "Legs" lines. The market leg is the live traded price
 * (the mover) — solid, accent-colored, 2px. The intrinsic/NAV leg is the
 * steady reference — muted and dashed so the eye reads it as the anchor the
 * market is measured against. The oracle leg (Pyth) is the third independent
 * source — a distinct brand accent (magenta, unused elsewhere on this chart)
 * so it's never confused with market (amber) or intrinsic (muted grey); dotted
 * so a market/oracle near-overlap (the common case — both track the real
 * price) still reads as two lines rather than merging into one.
 */
function legsSeriesThemeOptions(
  leg: "market" | "intrinsic" | "oracle",
  t: TvTokens,
) {
  if (leg === "intrinsic") {
    return {
      color: withAlpha(t.textMuted, 0.7),
      lineWidth: 1 as const,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
    };
  }
  if (leg === "oracle") {
    return {
      color: t.magenta,
      lineWidth: 1 as const,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
    };
  }
  return {
    color: t.stDrift,
    lineWidth: 2 as const,
    priceLineVisible: false,
    lastValueVisible: true,
    crosshairMarkerVisible: true,
  };
}

/** Crosshair tooltip body for "Legs" mode: the (up to three) raw USD legs
 *  plus the implied discount (the actual signal the market/intrinsic lines
 *  encode) and a per-hover "sources agree/disagree" read across whichever
 *  legs are present at THIS point (degrades gracefully to a 2-leg compare
 *  when the oracle leg is absent — sourcesDisagree fails safe to null below
 *  2 present legs). */
function LegsTooltipBody({
  market,
  intrinsic,
  oracle,
}: {
  market: number;
  intrinsic: number | null;
  oracle: number | null;
}) {
  const gap = intrinsic !== null ? impliedGapBps(market, intrinsic) : null;
  const verdict = sourcesDisagree({ intrinsic, market, oracle });
  return (
    <>
      <div className="mt-0.5 text-text">
        market <span className="text-st-drift">${market.toFixed(4)}</span>
      </div>
      {intrinsic !== null && (
        <div className="text-text-muted">
          intrinsic <span>${intrinsic.toFixed(4)}</span>
        </div>
      )}
      {oracle !== null && (
        <div className="text-magenta">
          oracle <span>${oracle.toFixed(4)}</span>
        </div>
      )}
      {gap !== null && (
        <div className="mt-0.5 text-text">
          {/* "raw" because this gap is the implied discount of the unsmoothed
              legs — it can differ from the EWMA-smoothed spread shown in the
              hero/rail; the difference is methodology, not a contradiction. */}
          raw gap <span>{formatGap(gap)}</span>
        </div>
      )}
      {verdict.maxSpreadBps !== null && (
        // Neutral per-hover numeric detail — the divergence VERDICT (amber) is
        // the hero OracleDegradedBadge's job; this is just the widest pairwise
        // source gap at the hovered point, no competing red/green agree/disagree.
        <div className="mt-0.5 text-text-muted">
          widest source gap{" "}
          <span className="font-mono">{verdict.maxSpreadBps}bps</span>
        </div>
      )}
    </>
  );
}

function seriesThemeOptions(mode: ViewMode, t: TvTokens) {
  if (mode === "baseline") {
    return {
      baseValue: { type: "price" as const, price: 0 },
      // Both sides are excursions from the peg — the engine classifies on
      // |discount|, so a premium (value < 0) is no more "benign" than a
      // discount (value > 0). Colour them SYMMETRICALLY (drift-ward, fading
      // from transparent at the peg to opaque at the extreme); the signed ±
      // guide lines carry the band detail. (Previously the premium side was
      // muted grey, which read as "safe" even while crossing the +depeg/
      // +critical guides.)
      topLineColor: t.stDrift,
      topFillColor1: withAlpha(t.stDrift, 0),
      topFillColor2: withAlpha(t.stDrift, 0.52),
      bottomLineColor: t.stDrift,
      bottomFillColor1: withAlpha(t.stDrift, 0),
      bottomFillColor2: withAlpha(t.stDrift, 0.52),
      lineWidth: 2 as const,
      priceLineVisible: false,
      lastValueVisible: true,
    };
  }
  if (mode === "area") {
    return {
      lineColor: t.stDrift,
      topColor: withAlpha(t.stDrift, 0.46),
      bottomColor: withAlpha(t.stDrift, 0),
      lineWidth: 2 as const,
      priceLineVisible: false,
      lastValueVisible: true,
    };
  }
  if (mode === "candle") {
    return {
      // Up = spread improved over the period (close > open) → pegged green.
      // Down = spread worsened → depeg red.
      upColor: t.stPegged,
      downColor: t.stDepeg,
      wickUpColor: t.stPegged,
      wickDownColor: t.stDepeg,
      borderVisible: false,
      priceLineVisible: false,
      lastValueVisible: true,
    };
  }
  return {
    color: t.stDrift,
    lineWidth: 2 as const,
    priceLineVisible: false,
    lastValueVisible: true,
  };
}

/**
 * Aggregates raw line samples into OHLC buckets of the given step in seconds.
 * Each output candle has:
 *   open  = first sample in the bucket
 *   close = last sample in the bucket
 *   high  = max value (closer to 0 / less negative)
 *   low   = min value (deeper discount)
 * Buckets with no samples are skipped (no synthetic gaps — the candlestick
 * series handles missing time slots fine).
 */
function aggregateCandles(
  samples: Array<{ time: UTCTimestamp; value: number }>,
  stepSeconds: number,
): CandlestickData[] {
  if (samples.length === 0) return [];
  const buckets = new Map<
    number,
    { o: number; h: number; l: number; c: number }
  >();
  for (const s of samples) {
    const bucketTime =
      Math.floor((s.time as number) / stepSeconds) * stepSeconds;
    const ex = buckets.get(bucketTime);
    if (!ex) {
      buckets.set(bucketTime, {
        o: s.value,
        h: s.value,
        l: s.value,
        c: s.value,
      });
    } else {
      ex.c = s.value;
      if (s.value > ex.h) ex.h = s.value;
      if (s.value < ex.l) ex.l = s.value;
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, b]) => ({
      time: time as UTCTimestamp,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    }));
}

/** Token color for a band role. */
function roleColor(role: ThresholdRole, t: TvTokens): string {
  if (role === "drift") return t.stDrift;
  if (role === "depeg") return t.stDepeg;
  return t.stCritical;
}

function addThresholdLines(
  series: ISeriesApi<SeriesType>,
  thresholds: { drift_bps: number; depeg_bps: number; critical_bps: number },
  t: TvTokens,
  directionSensitive: boolean,
): IPriceLine[] {
  const lines: IPriceLine[] = [];
  // Zero line — the peg itself (index 0; kept in sync with applyThresholdLineTheme).
  lines.push(
    series.createPriceLine({
      price: 0,
      color: t.outline,
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: false,
      title: "",
    }),
  );
  // drift/depeg/critical guides. Symmetric (±) for symmetric classes — a depeg
  // crosses its guide whether it shows as a discount (+) or a premium (−). For
  // direction-sensitive classes (LST/stable_yield) only the +discount side is
  // emitted (premium → PEGGED, ADR-0021), so the guides match what can trip.
  for (const spec of thresholdLineSpecs(thresholds, directionSensitive)) {
    lines.push(
      series.createPriceLine({
        price: spec.price,
        color: roleColor(spec.role, t),
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: spec.title,
      }),
    );
  }
  return lines;
}

function applyThresholdLineTheme(
  lines: IPriceLine[],
  thresholds: { drift_bps: number; depeg_bps: number; critical_bps: number },
  t: TvTokens,
  directionSensitive: boolean,
) {
  // Index 0 is the zero line; the rest follow thresholdLineSpecs() order.
  // `directionSensitive` MUST match the value passed to addThresholdLines so
  // the index→spec mapping stays aligned with the lines actually created.
  lines[0]?.applyOptions({ price: 0, color: t.outline, title: "" });
  thresholdLineSpecs(thresholds, directionSensitive).forEach((spec, i) => {
    lines[i + 1]?.applyOptions({
      price: spec.price,
      color: roleColor(spec.role, t),
      title: spec.title,
    });
  });
}
