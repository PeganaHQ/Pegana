import {
  CrosshairMode,
  LineStyle,
  type DeepPartial,
  type TimeChartOptions,
} from "lightweight-charts";

/**
 * Reads our CSS color tokens at runtime and maps them to a Lightweight Charts
 * theme. Keeping the source of truth in `globals.css` means the chart never
 * drifts from the rest of the UI when we tweak the palette.
 *
 * Must run on the client — `getComputedStyle` is browser-only.
 */
export interface TvTokens {
  canvas: string;
  chartCanvas: string;
  chartGrid: string;
  hairline: string;
  outline: string;
  text: string;
  textMuted: string;
  stPegged: string;
  stDrift: string;
  stDepeg: string;
  stCritical: string;
  magenta: string;
}

const DEFAULTS: TvTokens = {
  canvas: "#0a0a0b",
  chartCanvas: "#0d0d0f",
  chartGrid: "rgba(255, 255, 255, 0.07)",
  hairline: "rgba(255, 255, 255, 0.08)",
  outline: "rgba(255, 255, 255, 0.16)",
  text: "#f5f5f6",
  textMuted: "#a3a3ad",
  stPegged: "#5fd3a0",
  stDrift: "#e2a651",
  stDepeg: "#e87089",
  stCritical: "#e0574e",
  magenta: "#e878d8",
};

export function readTvTokens(): TvTokens {
  if (typeof window === "undefined") return DEFAULTS;
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  return {
    canvas: read("--color-canvas", DEFAULTS.canvas),
    chartCanvas: read("--color-chart-canvas", DEFAULTS.chartCanvas),
    chartGrid: read("--color-chart-grid", DEFAULTS.chartGrid),
    hairline: read("--color-hairline", DEFAULTS.hairline),
    outline: read("--color-outline", DEFAULTS.outline),
    text: read("--color-text", DEFAULTS.text),
    textMuted: read("--color-text-muted", DEFAULTS.textMuted),
    stPegged: read("--color-st-pegged", DEFAULTS.stPegged),
    stDrift: read("--color-st-drift", DEFAULTS.stDrift),
    stDepeg: read("--color-st-depeg", DEFAULTS.stDepeg),
    stCritical: read("--color-st-critical", DEFAULTS.stCritical),
    magenta: read("--color-magenta", DEFAULTS.magenta),
  };
}

export function tvChartOptions(t: TvTokens): DeepPartial<TimeChartOptions> {
  return {
    layout: {
      background: { color: t.chartCanvas },
      textColor: t.textMuted,
      fontFamily:
        "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 10,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: t.chartGrid, style: LineStyle.Solid },
      horzLines: { color: t.chartGrid, style: LineStyle.Solid },
    },
    rightPriceScale: {
      borderColor: t.hairline,
      scaleMargins: { top: 0.12, bottom: 0.12 },
    },
    timeScale: {
      borderColor: t.hairline,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 4,
      barSpacing: 4,
    },
    crosshair: {
      mode: CrosshairMode.Magnet,
      vertLine: {
        color: t.outline,
        width: 1,
        style: LineStyle.Dashed,
        labelBackgroundColor: t.outline,
      },
      horzLine: {
        color: t.outline,
        width: 1,
        style: LineStyle.Dashed,
        labelBackgroundColor: t.outline,
      },
    },
    handleScroll: true,
    handleScale: true,
    autoSize: true,
  };
}

/** rgba string from hex (#rrggbb) at given alpha 0..1 */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
