import {
  USDE_ASSETS_TOML,
  USDE_RECEIPTS,
  USDE_TICKS,
  USDE_WINDOW,
} from "./usde-replay-data";
import type { ReplayBundle } from "@/lib/verify-receipt";

export type ReplayState = "PEGGED" | "DRIFT" | "DEPEG" | "CRITICAL";

export interface ReplayMarker {
  file: string;
  /** Unix seconds of the receipt's `inputs_frozen.now`. */
  at: number;
  iso: string;
  state: ReplayState;
  previous: ReplayState;
  marketUsd: string;
  discountRaw: string;
  discountSmooth: string;
  sha256: string;
  bundle: ReplayBundle;
}

export const REPLAY_TICKS = USDE_TICKS;
export const REPLAY_WINDOW = USDE_WINDOW;

export const REPLAY_MARKERS: ReplayMarker[] = USDE_RECEIPTS.map((r) => {
  const f = r.inputs_frozen as Record<string, unknown>;
  const c = r.expected_computed as Record<string, string>;
  return {
    file: r.file,
    at: r.at,
    iso: f.now as string,
    state: c.final_state as ReplayState,
    previous: f.previous_state as ReplayState,
    marketUsd: f.market_usd as string,
    discountRaw: c.discount_raw,
    discountSmooth: c.discount_smooth,
    sha256: r.expected_receipt_sha256,
    bundle: {
      schema_version: r.schema_version,
      methodology_version: r.methodology_version,
      methodology_git_sha: r.methodology_git_sha,
      assets_toml_canonical: USDE_ASSETS_TOML,
      inputs_frozen: r.inputs_frozen as unknown as Record<string, unknown>,
      expected_computed: r.expected_computed as unknown as Record<string, unknown>,
      expected_receipt_sha256: r.expected_receipt_sha256,
    },
  };
});

export const RECEIPT_BASE_URL =
  "https://github.com/PeganaHQ/Pegana/blob/main/docs/backtests/2025-10-10-usde-depeg/receipts/";

export function receiptUrl(file: string): string {
  return `${RECEIPT_BASE_URL}${file}`;
}

export function replayCommand(file: string): string {
  return `pegana-replay --bundle docs/backtests/2025-10-10-usde-depeg/receipts/${file}`;
}

/** The receipt the replay ends on: the worst state reached. */
export function criticalMarker(): ReplayMarker {
  return (
    REPLAY_MARKERS.find((m) => m.state === "CRITICAL") ?? REPLAY_MARKERS[0]
  );
}

/** Chart geometry. Price axis is padded around the series and the guides. */
export interface ChartGeometry {
  w: number;
  h: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  yMin: number;
  yMax: number;
}

export const CHART: ChartGeometry = {
  w: 760,
  h: 300,
  padL: 52,
  padR: 16,
  padT: 16,
  padB: 30,
  yMin: 0.95,
  yMax: 1.002,
};

export function xFor(t: number, g: ChartGeometry = CHART): number {
  const span = REPLAY_WINDOW.to - REPLAY_WINDOW.from;
  return g.padL + ((t - REPLAY_WINDOW.from) / span) * (g.w - g.padL - g.padR);
}

export function yFor(price: number, g: ChartGeometry = CHART): number {
  const frac = (price - g.yMin) / (g.yMax - g.yMin);
  return g.padT + (1 - frac) * (g.h - g.padT - g.padB);
}

/** Verbatim receipt thresholds (bps) for the USDe stable_dn class. */
export function receiptThresholds(): {
  drift: number;
  depeg: number;
  critical: number;
} {
  const t = (REPLAY_MARKERS[0].bundle.inputs_frozen as {
    thresholds: { drift: number; depeg: number; critical: number };
  }).thresholds;
  return t;
}

/** Y-domain fitted to the data with modest padding (linear, USD). */
export function fitDomain(pad = 0.1): { yMin: number; yMax: number } {
  const ps = REPLAY_TICKS.map((k) => Number(k.p));
  const lo = Math.min(...ps);
  const hi = Math.max(...ps);
  const span = hi - lo || 0.01;
  return { yMin: lo - span * pad, yMax: hi + span * pad };
}

/** Well-spaced linear ticks (<= 4) inside the domain. */
export function linearTicks(
  yMin: number,
  yMax: number,
  step = 0.02,
): number[] {
  const out: number[] = [];
  const start = Math.ceil(yMin / step - 1e-9) * step;
  for (let v = start; v <= yMax + 1e-9; v += step) {
    out.push(Math.round(v * 10_000) / 10_000);
  }
  return out.slice(-4);
}

/** Close at or before `t` (the series is 1-minute; no interpolation). */
export function tickAtOrBefore(t: number): { t: number; p: string } {
  let cur = REPLAY_TICKS[0];
  for (const k of REPLAY_TICKS) {
    if (k.t <= t) cur = k;
    else break;
  }
  return cur;
}
