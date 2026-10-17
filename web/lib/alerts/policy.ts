/**
 * Telegram alert policy — the rules that govern when a subscriber actually
 * sees a notification land in their chat.
 *
 * SOURCE OF TRUTH:
 *   - per-asset thresholds: /assets.toml (`thresholds_bps` / `thresholds_cr`)
 *   - hysteresis window:    /crates/engine-rs/src/main.rs (CONFIRM_UP_SECS, DECAY_DOWN_SECS)
 *   - dedup windows:        /crates/dispatcher-rs/src/dedup.rs (silence_secs_for)
 *
 * This file mirrors those values so the asset detail page can show "you'll
 * get an alert when X happens" in plain English. Keep in sync when the
 * backend recalibrates — there's a runtime test that verifies the shape
 * matches AssetClass coverage.
 */

import type { AssetCardData, AssetClass } from "@/lib/api/types";

export interface AlertThresholds {
  drift_bps: number;
  depeg_bps: number;
  critical_bps: number;
}

/**
 * Per-symbol overrides — mirrors the `thresholds_bps` rows in /assets.toml for
 * every ACTIVE asset. Keep this complete: a missing entry silently falls back
 * to the (tighter) class default, which makes the engine's own state look like
 * a contradiction in the UI (e.g. sUSD trades ~2.2% off NAV by design and is
 * PEGGED — a 30 bps class fallback would say otherwise). hyUSD is intentionally
 * absent: it uses CR-based thresholds, not a bps band (see thresholds_cr).
 * Last synced with assets.toml: 2026-06-02.
 */
export const PER_ASSET_THRESHOLDS: Record<string, AlertThresholds> = {
  // LSTs (calibrated 2026-05-25 from 24h p99 distributions)
  jitoSOL: { drift_bps: 45, depeg_bps: 110, critical_bps: 250 },
  mSOL: { drift_bps: 40, depeg_bps: 100, critical_bps: 250 },
  bSOL: { drift_bps: 45, depeg_bps: 110, critical_bps: 250 },
  INF: { drift_bps: 140, depeg_bps: 280, critical_bps: 560 },
  bbSOL: { drift_bps: 45, depeg_bps: 110, critical_bps: 250 },
  JupSOL: { drift_bps: 60, depeg_bps: 150, critical_bps: 300 },
  hyloSOL: { drift_bps: 55, depeg_bps: 140, critical_bps: 280 },
  "hyloSOL+": { drift_bps: 30, depeg_bps: 120, critical_bps: 350 },
  // Fiat stables
  USDC: { drift_bps: 15, depeg_bps: 50, critical_bps: 200 },
  USDT: { drift_bps: 15, depeg_bps: 50, critical_bps: 200 },
  PYUSD: { drift_bps: 15, depeg_bps: 50, critical_bps: 200 },
  // CDP / delta-neutral
  USDS: { drift_bps: 20, depeg_bps: 75, critical_bps: 250 },
  USDe: { drift_bps: 25, depeg_bps: 100, critical_bps: 300 },
  // Yield-bearing — bands are per-asset and WIDE where the token sits at a
  // sustained gap to NAV by design (rebasing / thin secondary / NAV-vs-spot).
  sHYUSD: { drift_bps: 30, depeg_bps: 100, critical_bps: 300 },
  USDY: { drift_bps: 30, depeg_bps: 100, critical_bps: 250 },
  sUSDe: { drift_bps: 30, depeg_bps: 100, critical_bps: 300 },
  syrupUSDC: { drift_bps: 30, depeg_bps: 100, critical_bps: 250 },
  sUSD: { drift_bps: 275, depeg_bps: 500, critical_bps: 800 },
  ONyc: { drift_bps: 100, depeg_bps: 300, critical_bps: 800 },
  // xSOL — wide bands because the asset is leveraged by design
  xSOL: { drift_bps: 1500, depeg_bps: 3000, critical_bps: 6000 },
};

/**
 * Class fallbacks when an asset doesn't have a per-symbol entry. Roughly
 * matches the median calibration for each class in /assets.toml.
 */
export const CLASS_FALLBACK_THRESHOLDS: Record<AssetClass, AlertThresholds> = {
  lst: { drift_bps: 55, depeg_bps: 140, critical_bps: 280 },
  stable_fiat: { drift_bps: 15, depeg_bps: 50, critical_bps: 200 },
  stable_cdp: { drift_bps: 20, depeg_bps: 75, critical_bps: 250 },
  stable_dn: { drift_bps: 25, depeg_bps: 100, critical_bps: 300 },
  stable_rwa: { drift_bps: 30, depeg_bps: 120, critical_bps: 300 },
  stable_fx: { drift_bps: 30, depeg_bps: 120, critical_bps: 350 },
  stable_yield: { drift_bps: 30, depeg_bps: 100, critical_bps: 300 },
  synth_lev: { drift_bps: 1500, depeg_bps: 3000, critical_bps: 6000 },
};

/**
 * Dedup silence window per asset class — how long the dispatcher will
 * suppress a repeat alert for the same user + asset + severity bucket.
 * Mirrors /crates/dispatcher-rs/src/dedup.rs::silence_secs_for.
 */
export const DEDUP_SECONDS_BY_CLASS: Record<AssetClass, number> = {
  lst: 3600, // 1h — LSTs don't move fast
  stable_fiat: 1800, // 30min
  stable_cdp: 900, // 15min — hyUSD tracks CR closely
  stable_dn: 1800,
  stable_rwa: 1800,
  stable_fx: 1800,
  stable_yield: 900, // 15min — sHYUSD follows hyUSD stress
  synth_lev: 1800, // 30min — xSOL leverage swings naturally
};

/** Engine hysteresis — must hold this long to actually transition. */
export const CONFIRM_UP_SECS = 30;
export const DECAY_DOWN_SECS = 120;

/** True only when the API's per-asset `thresholds` is a well-formed bps triple.
 *  hyUSD's CR thresholds (different keys) and any malformed/absent value fail
 *  this and fall back to the local table — so wiring the API field can never
 *  break the bands. */
function isValidBpsThresholds(
  t: AssetCardData["thresholds"],
): t is AlertThresholds {
  return (
    !!t &&
    Number.isFinite(t.drift_bps) &&
    Number.isFinite(t.depeg_bps) &&
    Number.isFinite(t.critical_bps) &&
    t.drift_bps > 0
  );
}

/**
 * Resolve an asset's alert bands. Prefers the AUTHORITATIVE per-asset
 * `assets.thresholds` served by the API (so a Postgres recalibration reflects
 * in the UI immediately), falling back to the hand-maintained local table only
 * when the API value is absent or not a valid bps triple. `apiThresholds` is
 * `asset.thresholds` from `AssetCardData`.
 */
export function thresholdsFor(
  symbol: string,
  klass: AssetClass,
  apiThresholds?: AssetCardData["thresholds"],
): AlertThresholds {
  if (isValidBpsThresholds(apiThresholds)) {
    return apiThresholds;
  }
  return (
    PER_ASSET_THRESHOLDS[symbol] ??
    CLASS_FALLBACK_THRESHOLDS[klass] ??
    CLASS_FALLBACK_THRESHOLDS.stable_fiat
  );
}

export function dedupSecondsFor(klass: AssetClass): number {
  return DEDUP_SECONDS_BY_CLASS[klass] ?? 1800;
}

/** Human-readable silence window: "1h", "30 min", "15 min", "45s". */
export function formatDedupWindow(secs: number): string {
  if (secs >= 3600) {
    const h = secs / 3600;
    return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
  }
  if (secs >= 60) return `${Math.round(secs / 60)} min`;
  return `${secs}s`;
}

/** Format a bps threshold for display as a percentage — "bps" is internal
 *  jargon, never rendered to end users. Tiered precision so both a tight
 *  0.15% band and a wide 60% band stay readable: two decimals under 1%
 *  ("0.45%"), one decimal under 10% ("2.5%"), whole points at/above 10%
 *  ("15%"). */
export function formatThreshold(bps: number): string {
  if (bps < 100) return `${(bps / 100).toFixed(2)}%`;
  if (bps < 1000) return `${(bps / 100).toFixed(1)}%`;
  return `${(bps / 100).toFixed(0)}%`;
}
