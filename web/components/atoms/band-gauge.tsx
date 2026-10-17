"use client";

import { cn } from "@/lib/utils/cn";
import { bandProximity } from "@/lib/asset/band";
import { isDirectionSensitiveClass } from "@/lib/asset/chart-thresholds";
import { stateMeta } from "@/lib/asset/state-meta";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AlertThresholds } from "@/lib/alerts/policy";
import type { AssetClass, PegState } from "@/lib/api/types";

// Proximity-to-threshold micro-gauge — the on-thesis risk-oracle signal the raw
// spread number hides. Fill = |spread| as a fraction of the asset's OWN depeg
// line (so −40 bps reads as 80% for USDC but ~14% for INF). A faint tick marks
// the drift line. Colored by engine STATE (consistent with the pip / Fix 7),
// never by a raw-bps heuristic. Static — no animation, reduced-motion safe.
//
// Direction-sensitive (ADR-0021 carve-out, ships when `klass` is passed): for
// LST / stable_yield, a premium (market ABOVE intrinsic) is benign — holders
// always redeem at the intrinsic rate — so it reads as a calm, near-empty
// gauge instead of filling toward "depegged". Only the discount side counts.
// `klass` is optional so existing callers that don't pass it keep the prior
// symmetric (|spread|) reading unchanged.

export function BandGauge({
  bps,
  thresholds,
  state,
  klass,
  showValue = true,
  className,
}: {
  bps: number | null;
  thresholds: AlertThresholds;
  state: PegState;
  /** Asset class — enables the direction-sensitive premium carve-out. */
  klass?: AssetClass;
  showValue?: boolean;
  className?: string;
}) {
  // Engine has no trustworthy signal — a confident proximity percentage is
  // meaningless and contradicts the UNKNOWN label. Show "—" like a null bps.
  if (state === "UNKNOWN") {
    return (
      <span
        className={cn(
          "block text-right font-mono text-[11px] text-text-muted",
          className,
        )}
      >
        -
      </span>
    );
  }
  // `synth_lev` (xSOL) is direction-sensitive FOR DISPLAY too: a premium (market
  // above NAV) is expected leverage demand, not a depeg — so the gauge must not
  // read it as "off-scale / depegged beyond band". Matches the chart's call-site
  // carve-out (QA audit 2026-07-23); kept local so the global classification
  // (worst-sort/digest) is untouched.
  const directionSensitive = klass
    ? isDirectionSensitiveClass(klass) || klass === "synth_lev"
    : false;
  const isPremiumBenign = directionSensitive && bps != null && bps < 0;
  const prox = bandProximity(bps, thresholds, directionSensitive);
  if (prox == null) {
    return (
      <span
        className={cn(
          "block text-right font-mono text-[11px] text-text-muted",
          className,
        )}
      >
        -
      </span>
    );
  }
  const fillPct = Math.min(prox, 1) * 100;
  const offScale = prox > 1;
  const driftFrac =
    thresholds.depeg_bps > 0
      ? Math.min(thresholds.drift_bps / thresholds.depeg_bps, 1)
      : 0;
  const fill = stateMeta(state).dotVar;
  const displayPct = Math.min(Math.round(prox * 100), 100);
  const pctLabel = `${displayPct}%`;
  // Direction is load-bearing. The engine convention (reconcileBps /
  // discountToBps) is discount = (intrinsic − market)/intrinsic, so +bps is a
  // discount (market BELOW intrinsic) and −bps a premium (market ABOVE
  // intrinsic). |bps|-only proximity flattens the two, so the accessible label
  // must name the side. Zero/null reads as "at intrinsic".
  const direction =
    bps == null || bps === 0 ? "at" : bps < 0 ? "above" : "below";
  // Benign premium (ADR-0021 carve-out): a direction-sensitive asset trading
  // above intrinsic doesn't count toward its depeg band at all — say so
  // explicitly rather than let a silent "0%" read as an unexplained flatline.
  const baseProxText = isPremiumBenign
    ? `Premium. ${(Math.abs(bps as number) / 100).toFixed(2)}% above intrinsic, benign for this asset and doesn't count toward its depeg band`
    : direction === "at"
      ? `At intrinsic. ${displayPct}% of the way to this asset's depeg line`
      : `${displayPct}% of the way to this asset's depeg line (${direction} intrinsic)`;
  const proxText =
    offScale && !isPremiumBenign
      ? `${baseProxText}; off-scale / depegged beyond this asset's band`
      : baseProxText;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          // Already named via role="img" + aria-label, but not FOCUSABLE, so
          // the tooltip's extra detail stayed mouse-only for keyboard users.
          tabIndex={0}
          className={cn(
            "flex items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text",
            className,
          )}
          // aria-label carries the proximity reading for screen readers (the
          // gauge is the row's primary risk signal); the Tooltip now covers
          // hover/focus/touch, replacing the old touch-unreachable `title`.
          role="img"
          aria-label={proxText}
        >
          <span className="relative block h-2 flex-1 overflow-hidden bg-text/[0.08]">
            {/* drift threshold tick */}
            <span
              aria-hidden
              className="absolute inset-y-0 w-px bg-text/25"
              style={{ left: `${driftFrac * 100}%` }}
            />
            {/* proximity fill — sharp (brand reserves rounded-full for CTAs) */}
            {/* Deliberate, scoped exception to the flat-dot rule (A9,
                2026-07-16): the glow below fires ONLY when `offScale` is true
                — the asset has already blown through its own depeg band, a
                genuinely dangerous reading. This is emphasis on that one
                data point, not a liveness/pulse dot (which brand.md/MASTER
                LEIS NOVAS #3 bans everywhere else — see StatePip's "flat
                dot, no glow/pulse" comment). Keep it; it's chosen, not an
                accidental carry-over. */}
            <span
              aria-hidden
              className="absolute inset-y-0 left-0"
              style={{
                width: `${fillPct}%`,
                background: fill,
                boxShadow: offScale ? `0 0 6px ${fill}` : undefined,
              }}
            />
            {offScale && (
              <span
                aria-hidden
                className="absolute inset-y-[-2px] right-0 w-[3px]"
                style={{ background: fill, boxShadow: `0 0 8px ${fill}` }}
              />
            )}
          </span>
          {showValue && (
            <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-text-caption">
              {pctLabel}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>{`${proxText}. Depeg ${(thresholds.depeg_bps / 100).toFixed(2)}%`}</TooltipContent>
    </Tooltip>
  );
}
