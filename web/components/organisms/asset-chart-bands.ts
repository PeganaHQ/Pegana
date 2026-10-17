import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

/**
 * Threshold bps + direction-sensitivity needed to build the shaded bands.
 * Mirrors `addThresholdLines`'/`thresholdLineSpecs`'s inputs in
 * asset-chart.tsx exactly — callers MUST pass the SAME `thresholds` +
 * `directionSensitive` used for the dashed guide lines, so the filled bands
 * never disagree with them about where a band starts/ends.
 */
export interface ThresholdBandsOptions {
  driftBps: number;
  depegBps: number;
  /** Optional only for defensive typing — asset-chart's `thresholds` prop
   *  always supplies it. Without it, the depeg→critical and critical→edge
   *  bands collapse into a single depeg→edge band (rose color). */
  criticalBps?: number;
  directionSensitive: boolean;
}

/** One shaded rectangle spanning `[priceLow, priceHigh]` in the series' own
 *  signed bps price units. `Infinity` / `-Infinity` mean "to the edge of the
 *  visible pane" rather than a fixed price — there's no dashed guide line at
 *  the outer edge, the shading just keeps going to the top/bottom of the
 *  chart. */
export interface BandSpec {
  priceLow: number;
  priceHigh: number;
  color: string;
}

// Low-alpha fills so the bands read as ambient context — ANY of them visibly
// competing with the plot line or the dashed threshold guides drawn on top
// (zOrder "bottom") would defeat the point.
const AMBER_DRIFT_TO_DEPEG = "rgba(226, 166, 81, 0.06)";
const ROSE_DEPEG_TO_CRITICAL = "rgba(232, 112, 137, 0.07)";
const RED_CRITICAL_TO_EDGE = "rgba(224, 87, 78, 0.08)";

/**
 * Builds the signed band specs. Mirrors `thresholdLineSpecs`'s direction
 * logic exactly (see lib/asset/chart-thresholds.ts, ADR-0021):
 * direction-sensitive classes (LST, stable_yield) only ever trip on the
 * +discount side, so ONLY the positive-side bands are emitted for them —
 * shading the premium (−) side there would visually imply a risk that can
 * never actually fire. Symmetric classes get the mirrored negative-side
 * bands too, since a depeg can travel either way for them.
 */
export function bandSpecs(opts: ThresholdBandsOptions): BandSpec[] {
  const { driftBps, depegBps, criticalBps, directionSensitive } = opts;
  const positive: BandSpec[] = [];
  if (depegBps > driftBps) {
    positive.push({
      priceLow: driftBps,
      priceHigh: depegBps,
      color: AMBER_DRIFT_TO_DEPEG,
    });
  }
  if (criticalBps !== undefined && criticalBps > depegBps) {
    positive.push({
      priceLow: depegBps,
      priceHigh: criticalBps,
      color: ROSE_DEPEG_TO_CRITICAL,
    });
    positive.push({
      priceLow: criticalBps,
      priceHigh: Infinity,
      color: RED_CRITICAL_TO_EDGE,
    });
  } else {
    positive.push({
      priceLow: depegBps,
      priceHigh: Infinity,
      color: ROSE_DEPEG_TO_CRITICAL,
    });
  }
  // The chart plots the HOLDER-signed spread (premium +, discount −), so the
  // risk/discount band that direction-sensitive classes trip on is on the
  // NEGATIVE side. Symmetric classes shade BOTH. (Flipped in lockstep with the
  // series negation in asset-chart.tsx + thresholdLineSpecs — QA audit
  // 2026-07-23.) `-Infinity` priceLow = "to the bottom edge of the pane".
  const negative = positive.map((b) => ({
    priceLow: -b.priceHigh,
    priceHigh: -b.priceLow,
    color: b.color,
  }));
  if (directionSensitive) return negative;
  return [...negative, ...positive];
}

/** Converts a signed bps price to a bitmap-space y coordinate, or `null` when
 *  the series can't currently place it (e.g. before the price scale has any
 *  data) — the caller skips drawing that edge of the band rather than
 *  guessing at a fallback. */
function toBitmapY(
  series: ISeriesApi<SeriesType, Time>,
  price: number,
  verticalPixelRatio: number,
): number | null {
  const coord = series.priceToCoordinate(price);
  if (coord === null) return null;
  return Math.round(coord * verticalPixelRatio);
}

/**
 * Lightweight-charts v5 custom series primitive: draws the FILLED
 * drift/depeg/critical background bands behind the existing dashed threshold
 * LINES (`addThresholdLines` in asset-chart.tsx). Geometry is recomputed live
 * from `series.priceToCoordinate` on every `draw()` call rather than cached,
 * so it never goes stale across pans/zooms/autoscale range changes/theme
 * swaps — `updateAllViews` is a deliberate no-op. Always renders at
 * `zOrder: "bottom"` so the plot line + dashed guides stay visually on top.
 */
class ThresholdBandsPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private readonly _specs: BandSpec[];
  private readonly _views: readonly IPrimitivePaneView[];

  constructor(opts: ThresholdBandsOptions) {
    this._specs = bandSpecs(opts);
    this._views = [
      {
        zOrder: () => "bottom",
        renderer: (): IPrimitivePaneRenderer | null => {
          // Read `this._series` fresh on every renderer() call (rather than
          // capturing it once) so a late `attached()` — or a series swap —
          // is always reflected, even if the library caches `paneViews()`.
          const series = this._series;
          if (!series) return null;
          const specs = this._specs;
          return {
            draw(target) {
              target.useBitmapCoordinateSpace((scope) => {
                const ctx = scope.context;
                const width = scope.bitmapSize.width;
                const height = scope.bitmapSize.height;
                for (const spec of specs) {
                  const yTop =
                    spec.priceHigh === Infinity
                      ? 0
                      : toBitmapY(
                          series,
                          spec.priceHigh,
                          scope.verticalPixelRatio,
                        );
                  const yBottom =
                    spec.priceLow === -Infinity
                      ? height
                      : toBitmapY(
                          series,
                          spec.priceLow,
                          scope.verticalPixelRatio,
                        );
                  if (yTop === null || yBottom === null) continue;
                  ctx.fillStyle = spec.color;
                  ctx.fillRect(0, yTop, width, yBottom - yTop);
                }
              });
            },
          };
        },
      },
    ];
  }

  attached({ series }: SeriesAttachedParameter<Time, SeriesType>): void {
    this._series = series;
  }

  detached(): void {
    this._series = null;
  }

  updateAllViews(): void {
    // No-op: bands read the series' live price scale in `draw()`, so there's
    // no cached geometry to invalidate on pan/zoom/data updates.
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this._views;
  }
}

/** Factory — call with the SAME `thresholds` + `directionSensitive` passed to
 *  `addThresholdLines` for the same series, so the filled bands and the
 *  dashed guide lines never disagree about where a band starts/ends. */
export function createThresholdBands(
  opts: ThresholdBandsOptions,
): ISeriesPrimitive<Time> {
  return new ThresholdBandsPrimitive(opts);
}
