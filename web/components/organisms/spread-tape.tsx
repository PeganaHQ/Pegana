"use client";

import { useAssets } from "@/lib/hooks/use-assets";
import { holderSignedPct, reconcileBps } from "@/lib/api/format";
import { spreadSignClass } from "@/lib/state-class";
import { stateMeta } from "@/lib/asset/state-meta";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";
import { effectiveState, isStale } from "@/lib/asset/freshness";
import type { PegState } from "@/lib/api/types";

// Live spread tape — a horizontal scrolling ticker showing all tracked
// assets' current spread. Pure CSS marquee animation (mask-faded edges),
// same idiom as the SourcesV2 logo strip. Each cell is: symbol + spread
// value (colored by its holder sign). Calm/Quiet: no pulse, no flash —
// just the data drifting sideways, always there, never demanding attention.
//
// DESIGN.md: "max ONE marquee per page" — the SourcesV2 logo strip lives
// on the MARKETING landing only, this ticker lives on the APP dashboard,
// so the constraint holds per-surface.

export function SpreadTape({
  assets,
  liveOverrides,
  now,
}: {
  assets: ReturnType<typeof useAssets>["data"];
  liveOverrides: Record<
    string,
    { state?: PegState; discount?: string; updated_at?: string }
  >;
  now: number;
}) {
  if (!assets || assets.length === 0) return null;

  const cells = assets
    .filter((a) => !a.symbol.startsWith("_deprecated_"))
    .map((a) => {
      const live = liveOverrides[a.symbol];
      const state = effectiveState(live, a, now);
      const stale = isStale(live?.updated_at ?? a.updated_at, now);
      const { bps } = reconcileBps({
        discount: live?.discount ?? a.discount,
        intrinsic_usd: a.intrinsic_usd,
        market_usd: a.market_usd,
      });
      const hasBps = !stale && bps != null;
      const m = stateMeta(state);
      return { symbol: a.symbol, state, m, bps, hasBps };
    })
    .filter((c) => c.hasBps)
    .slice(0, 40); // cap for performance

  if (cells.length === 0) return null;

  return (
    <div
      className="relative overflow-hidden border-y border-hairline bg-surface-1/50 py-2 [mask-image:linear-gradient(90deg,transparent_0%,black_4%,black_96%,transparent_100%)] [-webkit-mask-image:linear-gradient(90deg,transparent_0%,black_4%,black_96%,transparent_100%)]"
      aria-hidden
    >
      <div className="flex w-max items-center gap-6 animate-[v2-lmarq_60s_linear_infinite] motion-reduce:animate-none will-change-transform">
        {[0, 1].map((loop) =>
          cells.map((c, i) => (
            <span
              key={`${loop}-${c.symbol}-${i}`}
              className="flex shrink-0 items-center gap-1.5"
            >
              <span
                className="h-1 w-1 shrink-0 rounded-full"
                style={{ background: c.m.dotVar }}
                aria-hidden
              />
              <span className="font-mono text-[11px] text-text-muted">
                {displaySymbol(c.symbol)}
              </span>
              <span
                className={cn(
                  "font-mono text-[11px] font-medium tabular-nums",
                  c.hasBps ? spreadSignClass(c.bps) : "text-text-caption",
                )}
              >
                {/* `-`, not 0.00%. Defensive, NOT a live fix: the `.filter(
                    (c) => c.hasBps)` above predates this and already drops
                    every cell without a usable spread, so the old
                    `holderSignedPct(c.bps ?? 0)` could not actually render
                    "0.00%" for an unknown. I claimed otherwise when I changed
                    it, and "verified" it by counting dashes on `/`, where this
                    tape does not render at all — it is the dashboard ticker.
                    An adversarial pass caught the overstatement.

                    Kept because it makes the two guards agree: if that filter
                    is ever relaxed, this cell degrades to "-" instead of
                    printing the most reassuring number a peg product has. */}
                {c.hasBps ? holderSignedPct(c.bps) : "-"}
              </span>
            </span>
          )),
        )}
      </div>
    </div>
  );
}
