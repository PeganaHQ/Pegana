// Command Center digest — deterministic, worst-first summary of the tracked
// universe. Zero LLM, zero invented causality: every line is a template over
// real fields (lib/asset/*, lib/api/format.ts, /v1/alerts, /v1/stats).
//
// Calm-day law (app re-imagination MASTER, LEIS NOVAS #1): the rest state
// (all Pegged, 0 transitions) must read as confident and intentional, never
// as an empty/negative placeholder. `verdictHeadline` therefore always ends
// on a positive, complete sentence, and `buildDigestLines` never emits a
// "0 changes" / "no transitions yet" line — a fact only appears when it has
// something real to say (closestToBand always fires since the universe is
// never empty; lastTransition and delivery-failure are omitted, not
// negated, when there's nothing to report).
//
// Crown jewels are NEVER recomputed here: PegState always comes from
// `effectiveState` (lib/asset/freshness — stale degrades to UNKNOWN), spread
// bps from `reconcileBps` (lib/api/format), proximity from `bandProximity`
// (lib/asset/band) fed by `thresholdsFor` (lib/alerts/policy), and jitter
// from `pegJitter` (lib/api/format). This module only assembles copy.

import type {
  AlertRow,
  AssetCardData,
  AssetClass,
  PegState,
} from "@/lib/api/types";
import { bandProximity } from "@/lib/asset/band";
import { isDirectionSensitiveClass } from "@/lib/asset/chart-thresholds";
import { effectiveState, isStale } from "@/lib/asset/freshness";
import { relativeStamp } from "@/lib/asset/relative-stamp";
import {
  formatBandAwayPct,
  isDeprecated,
  pegJitter,
  reconcileBps,
} from "@/lib/api/format";
import { stateMeta } from "@/lib/asset/state-meta";
import { thresholdsFor, type AlertThresholds } from "@/lib/alerts/policy";
import type { LiveOverride } from "@/lib/asset/worst-sort";

const EMPTY_OVERRIDES: Record<string, LiveOverride> = {};

function pluralize(
  n: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export interface VerdictCounts {
  /** Non-deprecated tracked universe. */
  total: number;
  /** effectiveState in {DEPEG, CRITICAL, BLACK_SWAN}. */
  offPeg: number;
  /** effectiveState === DRIFT. */
  drift: number;
  /** effectiveState === UNKNOWN (freshness-gated — a stale snapshot counts
   *  here, never as PEGGED). */
  unknown: number;
}

/**
 * Worst-first universe counts, freshness-gated via `effectiveState` — a
 * KNOWN-stale snapshot always lands in `unknown`, never in `offPeg`/`drift`
 * nor silently absorbed into "pegged". Deprecated assets are excluded (same
 * suppression as every other dashboard surface).
 */
export function computeVerdictCounts(
  assets: AssetCardData[] | undefined,
  liveOverrides: Record<string, LiveOverride> = EMPTY_OVERRIDES,
  now: number,
): VerdictCounts {
  let total = 0;
  let offPeg = 0;
  let drift = 0;
  let unknown = 0;
  for (const a of assets ?? []) {
    if (isDeprecated(a.symbol)) continue;
    total += 1;
    const s = effectiveState(liveOverrides[a.symbol], a, now);
    if (s === "DEPEG" || s === "CRITICAL" || s === "BLACK_SWAN") offPeg += 1;
    else if (s === "DRIFT") drift += 1;
    else if (s === "UNKNOWN") unknown += 1;
  }
  return { total, offPeg, drift, unknown };
}

/**
 * The worst-first, always-complete verdict headline. Exactly one branch
 * fires, in severity order; the calm-day branch is a positive sentence, not
 * an absence of the others.
 */
export function verdictHeadline(counts: VerdictCounts): string {
  const { total, offPeg, drift, unknown } = counts;
  if (offPeg > 0) {
    return `${pluralize(offPeg, "asset")} off peg right now.`;
  }
  if (drift > 0) {
    const holding = Math.max(0, total - drift);
    return `${pluralize(drift, "asset")} drifting. ${holding} holding peg.`;
  }
  if (unknown > 0) {
    return `All confirmable assets holding peg. ${unknown} unconfirmed.`;
  }
  return `All ${total} assets holding peg.`;
}

export interface VerdictPill {
  /** Worst-first PegState bucket whose color the chip wears. `offPeg` returns
   *  DEPEG here (the coarse "off peg" family); callers that want to distinguish
   *  a CRITICAL asset's red from DEPEG's rose refine this with a single scan
   *  (see useUniverseVerdict). */
  state: PegState;
  /** Terse worst-first label for an always-visible chip ("All holding",
   *  "2 drifting", "1 off peg"). */
  label: string;
}

/**
 * The one-glance topbar summary of the universe — same worst-first severity
 * order as `verdictHeadline`, condensed to a chip label. Calm day reads
 * "All holding" (green), never an empty/negative placeholder. When the WHOLE
 * universe is unconfirmable it says "Unconfirmed" rather than claiming a peg it
 * can't see (missing data != confirming data, H1/H9); a partial-unknown calm
 * day drops the "All" to "Holding" so the chip never overclaims coverage it
 * doesn't have.
 */
export function verdictPill(counts: VerdictCounts): VerdictPill {
  const { total, offPeg, drift, unknown } = counts;
  if (offPeg > 0) return { state: "DEPEG", label: `${offPeg} off peg` };
  if (drift > 0) return { state: "DRIFT", label: `${drift} drifting` };
  if (total > 0 && unknown === total)
    return { state: "UNKNOWN", label: "Unconfirmed" };
  if (unknown > 0) return { state: "PEGGED", label: "Holding" };
  return { state: "PEGGED", label: total > 0 ? "All holding" : "-" };
}

export interface ClosestToBand {
  symbol: string;
  name: string;
  mint: string;
  class: AssetClass;
  state: PegState;
  bps: number;
  /** Remaining distance to this asset's OWN depeg line, in bps (>= 0). */
  bpsAway: number;
  /** 0..1+ fraction of the way to the depeg line — the same ranking key the
   *  board/rows use, exposed here so the answer-card can reuse it. */
  prox: number;
  /** The resolved bands used for the ranking — API `thresholds` when valid,
   *  else the local table. Exposed so the card renders the SAME bands it ranked
   *  by (no re-derivation drift). */
  thresholds: AlertThresholds;
}

/**
 * The asset currently closest to breaking its OWN band — max `bandProximity`
 * among non-stale, non-deprecated, readable-spread assets. This is the
 * risk-magnitude signal (MASTER glossary): proximity to the asset's own
 * line, never raw |bps| (which would rank a wide-band LST's harmless drift
 * above a tight-band stable's real danger).
 *
 * Direction-sensitive (ADR-0021 carve-out): for LST / stable_yield, a
 * premium (bps < 0, market ABOVE intrinsic) is benign and contributes ZERO
 * proximity (`bandProximity`'s directionSensitive flag) — it must never win
 * the "closest to band" spot over a genuine discount-side risk elsewhere in
 * the universe, and `bpsAway` reports the full depeg distance (nothing to
 * report on a side that doesn't count) instead of a misleadingly small gap.
 */
export function closestToBand(
  assets: AssetCardData[] | undefined,
  liveOverrides: Record<string, LiveOverride> = EMPTY_OVERRIDES,
  now: number,
): ClosestToBand | null {
  let best: ClosestToBand | null = null;
  for (const a of assets ?? []) {
    if (isDeprecated(a.symbol)) continue;
    const live = liveOverrides[a.symbol];
    const effUpdatedAt = live?.updated_at ?? a.updated_at;
    if (isStale(effUpdatedAt, now)) continue;
    const { bps } = reconcileBps({
      discount: live?.discount ?? a.discount,
      intrinsic_usd: a.intrinsic_usd,
      market_usd: a.market_usd,
    });
    if (bps == null) continue;
    const t = thresholdsFor(a.symbol, a.class, a.thresholds);
    const directionSensitive = isDirectionSensitiveClass(a.class);
    const prox = bandProximity(bps, t, directionSensitive);
    if (prox == null) continue;
    if (!best || prox > best.prox) {
      const isBenignPremium = directionSensitive && bps < 0;
      const bpsAway = isBenignPremium
        ? t.depeg_bps
        : Math.max(0, Math.round(t.depeg_bps - Math.abs(bps)));
      const state = effectiveState(live, a, now);
      best = {
        symbol: a.symbol,
        name: a.name,
        mint: a.mint,
        class: a.class,
        state,
        bps,
        bpsAway,
        prox,
        thresholds: t,
      };
    }
  }
  return best;
}

export interface MostVolatile {
  symbol: string;
  name: string;
  mint: string;
  class: AssetClass;
  state: PegState;
  /** 24h dispersion of the discount series, in bps (lib/api/format#pegJitter). */
  jitterBps: number;
  /** Resolved bands (API `thresholds` when valid, else local) for the band the
   *  dashboard displays alongside the volatility figure. */
  thresholds: AlertThresholds;
}

/**
 * The asset with the widest 24h peg-stability dispersion — max `pegJitter`
 * among non-deprecated assets carrying a series. Never zero-by-default: an
 * asset with no usable series (<2 clean samples) is excluded, not counted
 * as maximally stable.
 */
export function mostVolatile(
  assets: AssetCardData[] | undefined,
  liveOverrides: Record<string, LiveOverride> = EMPTY_OVERRIDES,
  now: number,
): MostVolatile | null {
  let best: MostVolatile | null = null;
  for (const a of assets ?? []) {
    if (isDeprecated(a.symbol)) continue;
    const j = pegJitter(a.series_24h);
    if (j == null) continue;
    if (!best || j > best.jitterBps) {
      best = {
        symbol: a.symbol,
        name: a.name,
        mint: a.mint,
        class: a.class,
        state: effectiveState(liveOverrides[a.symbol], a, now),
        jitterBps: j,
        thresholds: thresholdsFor(a.symbol, a.class, a.thresholds),
      };
    }
  }
  return best;
}

export interface LastTransition {
  symbol: string;
  from: PegState;
  to: PegState;
  detectedAt: string;
  /** AlertRow.id — feeds the receipt link (/audit/:id). */
  alertId: string;
}

/**
 * The most recent REAL transition — filters out UNKNOWN->X / X->UNKNOWN
 * initializations (same filter as live-this-week.tsx), so a fresh-system
 * boot or a stale-recovery blip never masquerades as a state change. Assumes
 * `alerts` is already newest-first (the /v1/alerts contract every other
 * consumer relies on).
 */
export function lastRealTransition(
  alerts: AlertRow[] | undefined,
): LastTransition | null {
  if (!alerts) return null;
  const real = alerts.find(
    (a) => a.from_state !== "UNKNOWN" && a.to_state !== "UNKNOWN",
  );
  if (!real) return null;
  return {
    symbol: real.asset,
    from: real.from_state,
    to: real.to_state,
    detectedAt: real.detected_at,
    alertId: real.id,
  };
}

export interface DigestLine {
  text: string;
  /** Present only on the last-transition line — links to the byte-exact
   *  receipt for that alert. */
  href?: string;
  linkLabel?: string;
}

/**
 * Assemble the 2-4 worst-first digest lines. Never emits a negative/empty
 * line for an absent fact (no transitions ever recorded, no delivery
 * failures) — those facts are simply omitted, and the calm-day copy from
 * `closestToBand` + `lastRealTransition` (when one exists) already reads as
 * confident, not as "nothing happened".
 */
export function buildDigestLines(opts: {
  closest: ClosestToBand | null;
  transition: LastTransition | null;
  deliveryFailed24h: number;
  nowMs: number;
}): DigestLine[] {
  const lines: DigestLine[] = [];

  if (opts.closest) {
    lines.push({
      text: `Closest to its band: ${opts.closest.symbol}, ${formatBandAwayPct(opts.closest.bpsAway)} away.`,
    });
  }

  if (opts.transition) {
    const fromLabel = stateMeta(opts.transition.from).label;
    const toLabel = stateMeta(opts.transition.to).label;
    // relativeStamp already returns a complete "Ns/Nm/Nh/Nd ago" (or "just
    // now") string — do not append a second " ago".
    const rel =
      relativeStamp(opts.transition.detectedAt, opts.nowMs) ?? "recently";
    lines.push({
      text: `Last transition: ${opts.transition.symbol} ${fromLabel}→${toLabel}, ${rel}.`,
      href: `/audit/${opts.transition.alertId}`,
      linkLabel: "receipt →",
    });
  }

  if (opts.deliveryFailed24h > 0) {
    lines.push({
      text: `${pluralize(opts.deliveryFailed24h, "delivery", "deliveries")} failed in 24h.`,
    });
  }

  return lines;
}
