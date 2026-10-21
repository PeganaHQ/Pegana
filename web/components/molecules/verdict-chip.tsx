"use client";

import Link from "@/components/atoms/intent-link";
import { StatePip } from "@/components/atoms/state-pip";
import { stateMeta } from "@/lib/asset/state-meta";
import { holderSignedPct } from "@/lib/api/format";
import {
  spreadSignClass } from "@/lib/state-class";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { PegState } from "@/lib/api/types";

// A problem asset, surfaced in the dashboard verdict-hero as a clickable pill
// (worst-first): the actual asset that's drifting/off-peg, not buried in prose.
// State dot is FLAT (StatePip, no glow); a stale/unreadable spread shows "—",
// never a fabricated number (freshness gate upstream sets hasBps).
export function VerdictChip({
  symbol,
  state,
  bps,
  hasBps,
  className,
}: {
  symbol: string;
  state: PegState;
  bps: number;
  hasBps: boolean;
  className?: string;
}) {
  const m = stateMeta(state);
  return (
    <Link
      href={`/asset/${encodeURIComponent(symbol)}`}
      className={cn(
        // NOT a cardSurface. This is a state-tinted PILL: `rounded-full`, no
        // fill, and a border that `m.badgeClass` colours by peg state. Routing
        // it through the card helper forced `border-hairline bg-surface-1`
        // underneath and left the state tint to win a class merge, which is
        // exactly the kind of "a class is not proof of a colour" fragility
        // AGENTS.md documents. It transitions border-color because the badge
        // class changes it, not because of a hover ring.
        "group inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 transition-[box-shadow,transform,border-color] duration-150 ease-out hover:ring-2 hover:ring-outline/80 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
        m.badgeClass,
        className,
      )}
    >
      <StatePip state={state} size={6} />
      <span className="font-mono text-[12px] font-medium text-text">
        {displaySymbol(symbol)}
      </span>
      <span
        className={cn(
          "font-mono text-[11px] tabular-nums",
          hasBps ? spreadSignClass(bps) : "text-text-caption",
        )}
      >
        {hasBps ? holderSignedPct(bps) : "-"}
      </span>
    </Link>
  );
}
