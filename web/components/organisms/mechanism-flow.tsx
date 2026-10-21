"use client";

import NextLink from "@/components/atoms/intent-link";
import { cn } from "@/lib/utils/cn";
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";
import {
  holderSignedPct,
  formatUsdValue,
  reconcileBps,
  spreadSignClass,
  spreadSignVar,
  type ReconciledSpread,
} from "@/lib/api/format";
import { stateMeta } from "@/lib/asset/state-meta";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { AssetCardData, PegState } from "@/lib/api/types";

interface MechanismFlowProps {
  asset: AssetCardData;
  /** Pre-reconciled spread from the page level. Falls back to local
   *  reconciliation if the parent didn't pre-compute it (e.g. embeds). */
  spread?: ReconciledSpread;
  className?: string;
}

interface MechanismSpec {
  /** Short tag identifying where the fair value comes from. */
  fair_value_source: string;
  /** Plain-English description of what the fair value *represents*. */
  fair_value_caption: string;
  /** Short tag for the market quote source. */
  market_source: string;
  /** Plain-English description of what the market value *represents*. */
  market_caption: string;
}

// Friendly per-class copy. Goal: a casual user can read each caption and
// answer "what is this number telling me?" without prior context.
const SPEC: Record<string, MechanismSpec> = {
  lst: {
    fair_value_source: "Stake-pool value",
    fair_value_caption:
      "What 1 token is worth right now, based on the SOL it's staked into.",
    market_source: "Cheapest Solana DEX route",
    market_caption:
      "What you'd actually pay for 1 token now, best route on Jupiter.",
  },
  stable_fiat: {
    fair_value_source: "Hard $1 anchor",
    fair_value_caption:
      "Treated as exactly $1; backed by off-chain reserves with public attestation.",
    market_source: "Cheapest Solana DEX route",
    market_caption: "What 1 token trades for on Solana right now.",
  },
  stable_cdp: {
    fair_value_source: "Hylo $1 anchor",
    fair_value_caption: "On-chain $1 anchor backed by overcollateralized SOL.",
    market_source: "Cheapest Solana DEX route",
    market_caption: "What 1 token trades for on Solana right now.",
  },
  stable_dn: {
    fair_value_source: "Hedged $1 anchor",
    fair_value_caption:
      "$1 anchor kept by delta-hedging the underlying collateral.",
    market_source: "Cheapest Solana DEX route",
    market_caption: "What 1 token trades for on Solana right now.",
  },
  stable_fx: {
    fair_value_source: "FX rate (oracle)",
    fair_value_caption:
      "What 1 unit of the local currency is worth in USD right now.",
    market_source: "Cheapest Solana DEX route",
    market_caption: "What 1 token trades for on Solana right now.",
  },
  stable_yield: {
    fair_value_source: "Pool share value",
    fair_value_caption:
      "Your share of the underlying yield pool, denominated in USD.",
    market_source: "Cheapest Solana DEX route",
    market_caption: "What 1 token trades for on Solana right now.",
  },
  synth_lev: {
    fair_value_source: "Hylo reserve (on-chain)",
    fair_value_caption:
      "What 1 xSOL is backed by; computed directly from Hylo's on-chain reserve.",
    market_source: "Cheapest Solana DEX route",
    market_caption:
      "What you'd actually pay for 1 xSOL now, best route on Jupiter.",
  },
  stable_rwa: {
    fair_value_source: "Issuer reference",
    fair_value_caption:
      "What the issuer says 1 token is worth, published via oracle.",
    market_source: "Cheapest Solana DEX route",
    market_caption: "What 1 token trades for on Solana right now.",
  },
};

// STATE_STROKE intentionally diverges from the canonical dotVar on PEGGED
// (`var(--color-text)` here, neutral, vs `var(--color-st-pegged)`
// canonically) and UNKNOWN (`var(--color-text-muted)` vs
// `var(--color-st-unknown)`) — mirrors the same "PEGGED reads neutral, not
// green" decision onto this diagram's connector stroke. Kept local, not
// migrated to lib/asset/state-meta.ts.
const STATE_STROKE: Record<PegState, string> = {
  PEGGED: "var(--color-text)",
  DRIFT: "var(--color-st-drift)",
  DEPEG: "var(--color-st-depeg)",
  CRITICAL: "var(--color-st-critical)",
  BLACK_SWAN: "var(--color-st-critical)",
  UNKNOWN: "var(--color-text-muted)",
};

/**
 * Plain-English headline describing where the asset trades vs fair value.
 * Tone follows the server-side state so wide-but-tolerated gaps (e.g.
 * leveraged synths) don't read as alarmist.
 */
function buildHeadline(
  symbol: string,
  bps: number | null,
  state: PegState,
): string {
  if (bps == null) return `${symbol} is waiting for its next price sample.`;
  const absBps = Math.abs(bps);
  const pct = (absBps / 100).toFixed(absBps < 1000 ? 2 : 1);
  if (absBps < 5) return `${symbol} is trading right at fair value.`;
  const direction = bps > 0 ? "below" : "above";
  switch (state) {
    case "PEGGED":
      return `${symbol} is trading ${pct}% ${direction} fair value.`;
    case "DRIFT":
      return `${symbol} is drifting ${pct}% ${direction} fair value.`;
    case "DEPEG":
      return `${symbol} has depegged; trading ${pct}% ${direction} fair value.`;
    case "CRITICAL":
    case "BLACK_SWAN":
      return `${symbol} is in critical depeg territory. ${pct}% ${direction} fair value.`;
    default:
      return `${symbol} is trading ${pct}% ${direction} fair value.`;
  }
}

/**
 * Optional second line for the headline. Shown only when the headline's
 * literal number could mislead — e.g. a leveraged synth with a large but
 * tolerated gap, or any asset at zero spread.
 */
function buildSubcaption(
  bps: number | null,
  state: PegState,
  klass: string,
): string | null {
  if (bps == null) return null;
  if (state === "PEGGED" && Math.abs(bps) >= 50 && klass === "synth_lev") {
    return "Within Pegana's pegged threshold for leveraged synths.";
  }
  if (state === "PEGGED" && Math.abs(bps) >= 50 && klass === "stable_fx") {
    return "Within tolerance for FX-pegged assets.";
  }
  if (Math.abs(bps) >= 5 && Math.abs(bps) < 15 && state === "PEGGED") {
    return "Well inside peg tolerance; typical secondary-market noise.";
  }
  return null;
}

// Live pricing panel. Top: plain-English headline of where the asset is
// trading. Middle: the two actual numbers (fair value vs trading price) with
// human-readable labels and one-line descriptions. Bottom: a literal gap
// visualization and the math (compact, for the curious).
export function MechanismFlow({
  asset,
  spread,
  className,
}: MechanismFlowProps) {
  const spec = SPEC[asset.class] ?? SPEC.stable_fiat;
  const reconciled = spread ?? reconcileBps(asset);
  const bps = reconciled.bps;
  const suspect = reconciled.suspect;
  // Holder convention (+ = premium, − = discount), matching the hero + every
  // other tab — the mechanism tab used to print the raw `formatGap(bps)` (−83.5%
  // for xSOL) which contradicted the +83.5% shown one tab over (QA 2026-07-23).
  const bpsLabel = bps == null ? "-" : holderSignedPct(bps);
  const state = asset.state ?? "UNKNOWN";

  const fairValue = asset.intrinsic_usd
    ? formatUsdValue(asset.intrinsic_usd)
    : null;
  const marketValue = asset.market_usd
    ? formatUsdValue(asset.market_usd)
    : null;

  const headline = buildHeadline(displaySymbol(asset.symbol), bps, state);
  const subcaption = buildSubcaption(bps, state, asset.class);

  return (
    <div className={cn(className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[28px] font-medium leading-[1.1] tracking-[-0.01em] text-text">
          How {displaySymbol(asset.symbol)} is priced
        </h2>
        <NextLink
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:text-text"
          href="/methodology"
        >
          Methodology
          <IconArrowRight size={11} />
        </NextLink>
      </div>
      <p className="mb-6 mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
        Fair value vs where it trades right now · live gap in %
      </p>

      <div className="rounded-[20px] border border-hairline bg-surface-1 p-6 sm:p-8">
        {/* The plain-English headline. This is the takeaway — a user should
            be able to read this one sentence and know what's going on. */}
        <p
          className={cn(
            "max-w-[760px] text-[19px] font-medium leading-[1.35] tracking-[-0.01em] sm:text-[22px]",
            stateMeta(state).severityTextClass,
          )}
        >
          {headline}
        </p>
        {subcaption && (
          <p className="mt-2 max-w-[660px] text-[13px] leading-relaxed text-text-muted">
            {subcaption}
          </p>
        )}
        {suspect && (
          <p className="mt-3 inline-flex items-center gap-2 border border-st-drift/40 bg-st-drift/[0.04] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-st-drift">
            <span aria-hidden>⚠</span>
            Live gap shown below comes from on-chain prices, not the smoothed
            feed.
          </p>
        )}

        {/* The two underlying numbers. Labels translated, captions describe
            what each number *means* to the user — not how it's computed. */}
        <div className="mt-9 grid gap-7 sm:grid-cols-2 sm:gap-12">
          <Side
            kicker="Fair value"
            tag={spec.fair_value_source}
            value={fairValue}
            caption={spec.fair_value_caption}
          />
          <Side
            kicker="Trading at"
            tag={spec.market_source}
            value={marketValue}
            caption={spec.market_caption}
            align="right"
          />
        </div>

        {/* Visual gap — turns the two numbers into a distance you can see. */}
        <SpreadBar
          bps={bps}
          bpsLabel={bpsLabel}
          fairValue={fairValue}
          marketValue={marketValue}
          state={state}
        />
      </div>
    </div>
  );
}

function Side({
  kicker,
  tag,
  value,
  caption,
  align,
}: {
  kicker: string;
  tag: string;
  value: string | null;
  caption: string;
  align?: "right";
}) {
  return (
    <div className={cn(align === "right" && "sm:text-right")}>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
        {kicker}
      </div>
      <div
        className={cn(
          "mt-2 flex items-baseline gap-2 text-[28px] font-medium leading-tight tracking-[-0.02em] tabular-nums sm:text-[34px]",
          align === "right" && "sm:justify-end",
        )}
      >
        {value ?? <span className="text-text-muted/60">-</span>}
      </div>
      <div className="mt-1.5 text-[13px] text-text-body">{tag}</div>
      <p
        className={cn(
          "mt-2 max-w-[440px] text-[12px] leading-relaxed text-text-muted",
          align === "right" && "sm:ml-auto",
        )}
      >
        {caption}
      </p>
    </div>
  );
}

/**
 * Horizontal gap visualization. Two dots — fair value on the left, market on
 * the right — separated by a colored connector whose width is the |spread|,
 * scaled with a √-curve so tiny LST drift (5 bps) is still legible without
 * letting catastrophic gaps blow past the container. The caption below is
 * a single-line plain-English version of the math, kept small.
 */
function SpreadBar({
  bps,
  bpsLabel,
  fairValue,
  marketValue,
  state,
}: {
  bps: number | null;
  bpsLabel: string;
  fairValue: string | null;
  marketValue: string | null;
  state: PegState;
}) {
  if (bps == null || fairValue == null || marketValue == null) {
    return (
      <div className="mt-9 border-t border-hairline pt-6">
        <p className="font-mono text-[12px] text-text-muted">
          Waiting for next sample…
        </p>
      </div>
    );
  }

  const absBps = Math.abs(bps);
  const gapFrac = Math.min(Math.sqrt(absBps / 500), 1);
  const minGap = 8;
  const maxGap = 78;
  const gapPct = minGap + gapFrac * (maxGap - minGap);
  const leftPct = (100 - gapPct) / 2;
  const rightPct = leftPct + gapPct;

  const stateColor = STATE_STROKE[state];

  const x1 = leftPct * 2;
  const x2 = rightPct * 2;
  const midX = (x1 + x2) / 2;

  return (
    <div className="mt-9">
      <div className="relative pt-5">
        {/* Floating gap label centered above the connector.
            The connector itself stays state-stroked — it draws the STATE. This
            label is a NUMBER, so it takes its sign colour instead: the same
            split used by the /events day-group (state word vs number) and the
            compare legend (series swatch vs number). It used to share
            `stateColor`, which rendered jitoSOL's "−0.09%" white here while the
            hero above showed the very same number in red. */}
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 font-mono text-[11px] uppercase tracking-[0.08em] tabular-nums"
          style={{ left: `${midX / 2}%`, color: spreadSignVar(bps) }}
        >
          {bpsLabel}
        </div>
        <svg
          viewBox="0 0 200 18"
          preserveAspectRatio="none"
          className="h-[18px] w-full"
          aria-hidden
        >
          <line
            x1="0"
            y1="9"
            x2="200"
            y2="9"
            stroke="var(--color-hairline)"
            strokeWidth="0.5"
          />
          <line
            x1={x1}
            y1="9"
            x2={x2}
            y2="9"
            stroke={stateColor}
            strokeWidth="1.8"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={x1}
            cy="9"
            r="3.5"
            fill="var(--color-canvas)"
            stroke="var(--color-text)"
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={x2}
            cy="9"
            r="3.5"
            fill="var(--color-canvas)"
            stroke={stateColor}
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={x1}
            y1="4"
            x2={x1}
            y2="14"
            stroke="var(--color-text)"
            strokeWidth="0.5"
          />
          <line
            x1={x2}
            y1="4"
            x2={x2}
            y2="14"
            stroke={stateColor}
            strokeWidth="0.5"
          />
        </svg>
      </div>

      {/* The math, compact. Kept for verifiability, de-emphasized so it
          doesn't compete with the plain-English headline above. */}
      <div className="mt-5 border-l-2 border-text/20 pl-3 font-mono text-[11px] leading-relaxed text-text-muted">
        <span className="text-text-caption">How it&apos;s calculated</span>
        <span className="mx-2 opacity-40">·</span>
        (trading − fair) ÷ fair ={" "}
        <span className={cn("tabular-nums", spreadSignClass(bps))}>
          {bpsLabel}
        </span>
        <span className="mx-2 opacity-40">·</span>
        EWMA-smoothed.
      </div>
    </div>
  );
}
