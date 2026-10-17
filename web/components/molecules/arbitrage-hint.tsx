"use client";

import { holderSignedPct, isLowLiquidity, spreadSignClass } from "@/lib/api/format";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { AssetClass, PegState } from "@/lib/api/types";

interface ArbitrageHintProps {
  symbol: string;
  intrinsicUsd: string | null;
  marketUsd: string | null;
  discountBps: number | null;
  /** Current engine state — the hint is suppressed when UNKNOWN because the
   *  engine has no trustworthy signal to base an arb direction on. */
  state?: PegState;
  /** Asset class — the hint is suppressed for `synth_lev` (leveraged synths
   *  trade at a large premium/discount to NAV BY DESIGN; there is no peg to
   *  arb back to, so a "mint & sell the gap" suggestion is actively misleading
   *  — 2026-07-23 QA audit). */
  klass?: AssetClass;
  className?: string;
}

// Single-line hint. Renders only when the gap is meaningful (>50 bps) and the
// market isn't thin. Direction is computed from the sign of the discount and
// we tell the user the magnitude in absolute units so it's actionable. We do
// NOT claim profitability — fees, slippage and redemption windows aren't
// modelled.
export function ArbitrageHint({
  symbol,
  intrinsicUsd,
  marketUsd,
  discountBps,
  state,
  klass,
  className,
}: ArbitrageHintProps) {
  // Engine can't classify the asset — suppress the actionable arb suggestion.
  if (state === "UNKNOWN") return null;
  // Leveraged synths trade off-NAV by design — there is no peg to arb toward,
  // so the mint/sell suggestion would be nonsense (QA audit 2026-07-23).
  if (klass === "synth_lev") return null;
  if (discountBps == null) return null;
  if (Math.abs(discountBps) < 50) return null;
  if (isLowLiquidity(symbol)) return null;
  if (intrinsicUsd == null || marketUsd == null) return null;

  const marketUnderIntrinsic = discountBps > 0;
  const intrinsicN = parseFloat(intrinsicUsd);
  const marketN = parseFloat(marketUsd);
  if (
    !Number.isFinite(intrinsicN) ||
    !Number.isFinite(marketN) ||
    marketN === 0
  )
    return null;
  const gross = Math.abs(intrinsicN - marketN);

  return (
    <aside
      className={cn(
        "rounded-[16px] border border-hairline bg-surface-1/50 p-4",
        className,
      )}
      role="note"
      aria-label="Arbitrage hint"
    >
      <span className="text-st-drift">arb hint</span>
      <span className="mx-2 opacity-60">·</span>
      <span className={spreadSignClass(discountBps)}>
        {holderSignedPct(discountBps)}
      </span>
      <span className="mx-2 opacity-60">·</span>
      {marketUnderIntrinsic ? (
        <>
          market <span className="text-text">${gross.toFixed(4)}</span> under
          intrinsic; buying {displaySymbol(symbol)} on Jupiter and redeeming
          via the mechanism captures the gap, before fees.
        </>
      ) : (
        <>
          market <span className="text-text">${gross.toFixed(4)}</span> over
          intrinsic; minting {displaySymbol(symbol)} via the mechanism and
          selling on Jupiter captures the gap, before fees.
        </>
      )}
    </aside>
  );
}
