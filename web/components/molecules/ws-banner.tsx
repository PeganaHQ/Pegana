"use client";

import { useLive } from "@/lib/store/live-context";
import { useStats } from "@/lib/hooks/use-stats";

// Soft-tone sibling to HealthBanner (hard tone, role="alert"). Only one
// status strip renders at a time directly below the topbar: a full REST
// outage (HealthBanner) is the superset condition, so it takes priority and
// this banner stays silent rather than stacking a second row underneath it.
export function WsBanner() {
  const { disconnectedSinceMs } = useLive();
  const { error: restError } = useStats();
  if (disconnectedSinceMs == null || restError) return null;
  const mins = Math.round(disconnectedSinceMs / 60_000);
  return (
    <div
      role="status"
      className="sticky top-[calc(var(--app-topbar-h)+env(safe-area-inset-top))] z-30 border-b border-hairline bg-canvas/60 backdrop-blur-md lg:top-[73px]"
    >
      <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-5 py-2 font-mono text-[11px] tracking-[0.04em] text-text-muted sm:px-8 lg:px-12 xl:px-20">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-st-drift" />
        <span className="uppercase text-st-drift">live disconnected</span>
        <span>·</span>
        <span>
          no updates for {mins} min; values shown may be stale; retrying in
          background
        </span>
      </div>
    </div>
  );
}
