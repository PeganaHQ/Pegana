"use client";

import { useState } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { StatePip } from "@/components/atoms/state-pip";
import { cardSurface } from "@/components/atoms/surface-card";
import { DashboardVerdict } from "@/components/organisms/dashboard-verdict";
import type { ProblemAsset } from "@/components/organisms/dashboard-verdict";
import { UniverseStrip } from "@/components/molecules/universe-strip";
import { verdictPill } from "@/lib/asset/digest";
import type {
  ClosestToBand,
  LastTransition,
  VerdictCounts,
} from "@/lib/asset/digest";
import { cn } from "@/lib/utils/cn";

// System status hover-card — hover-not-click rebuild (2026-07-14, founder
// feedback: the click-modal read as "too ugly/square" and demanded an extra
// tap for a glance-only surface). Same relocation story as before (see the
// table-first rebuild note this replaces): the board IS the dashboard, and
// the verdict-hero + universe strip live behind this trigger instead of
// sitting on top of every visit — but now the trigger reveals them on HOVER
// (desktop) or FOCUS (keyboard/tap), matching how tooltip.tsx already skins
// its radix primitive in full V5 (rounded-[20px], hairline border, soft
// shadow — see components/ui/hover-card.tsx). DashboardVerdict and
// UniverseStrip render here VERBATIM (same crown-jewel data, same calm-day/
// off-peg/unknown branches), so every honesty guarantee those components
// already carry (freshness-gated states, "missing data != confirming data",
// no fabricated numbers) still holds inside the card. The trigger itself
// reuses `verdictPill` (lib/asset/digest) so its worst-first label can never
// drift out of sync with the headline it's a shorthand for.
//
// Resilience note: this component does no branching of its own on the
// incoming data — a hard backend outage or a genuinely empty universe simply
// flows through as `total: 0` / empty arrays, and `verdictPill`/
// `DashboardVerdict` already render an honest state for that (e.g. the
// trigger reads "—", the card headline reads "All 0 assets holding peg.").
// The trigger button is therefore always safe to mount wherever the caller
// has counts to give it.
//
// Touch fix (2026-07-16, A1): Radix's HoverCardTrigger wraps its
// pointerenter/pointerleave handlers in an internal `excludeTouch` guard
// (@radix-ui/react-hover-card — event.pointerType === "touch" is a no-op),
// so a tap on iOS/Android never opened this card and there was no other
// route to the verdict-hero + universe strip behind it. Fixed by lifting the
// card to a CONTROLLED HoverCard (`open`/`onOpenChange`) and adding a plain
// `onClick` on the trigger button that toggles `open` directly — Radix still
// drives `onOpenChange` on hover/focus/blur exactly as before (desktop is
// unchanged), so the net behavior is hover OR tap both open it.
export function SystemStatusHoverCard({
  counts,
  closest,
  transition,
  problemAssets,
  nowMs,
  tracked,
  alerts24h,
  deliverySent,
  deliveryFailed,
  updatedAgo,
  className,
}: {
  counts: VerdictCounts;
  closest: ClosestToBand | null;
  transition: LastTransition | null;
  problemAssets: ProblemAsset[];
  nowMs: number;
  tracked: number;
  alerts24h: number;
  deliverySent: number;
  deliveryFailed: number;
  updatedAgo?: string;
  className?: string;
}) {
  const pill = verdictPill(counts);
  // Controlled so a touch tap (which Radix's hover primitive ignores by
  // design) has a real way in — see the touch-fix note above.
  const [open, setOpen] = useState(false);

  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={`System status: ${pill.label}. Hover, focus, or tap for the full verdict.`}
          className={cn(
            cardSurface({
              className:
                "inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[11px] font-medium text-text",
            }),
            className,
          )}
        >
          {/* Flat dot, no glow/pulse — liveness lives only in the real
              timestamp inside UniverseStrip (MASTER LEIS NOVAS #3). */}
          <StatePip state={pill.state} size={6} />
          <span>{pill.label}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        align="end"
        className="w-[360px] max-w-[calc(100vw-2rem)]"
      >
        <div className="border-b border-hairline px-5 py-3.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption">
            System status
          </span>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 pb-5">
          <DashboardVerdict
            counts={counts}
            closest={closest}
            transition={transition}
            problemAssets={problemAssets}
            nowMs={nowMs}
            className="pb-4 pt-4 sm:pt-4"
          />
          <UniverseStrip
            tracked={tracked}
            alerts24h={alerts24h}
            deliverySent={deliverySent}
            deliveryFailed={deliveryFailed}
            updatedAgo={updatedAgo}
          />
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
