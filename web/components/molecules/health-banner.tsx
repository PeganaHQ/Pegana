"use client";

import Link from "@/components/atoms/intent-link";
import { useLive } from "@/lib/store/live-context";
import { useLiveUpdatesPaused } from "@/lib/hooks/use-live-updates-paused";
import { LIVE_PAUSED_INLINE } from "@/lib/api/rate-limit-copy";

// Single site-wide freshness line under the topbar. It used to print the raw
// API condition ("Rate limited (60 requests a minute per IP)", "API responded
// 503") with a Retry button the moment any /v1/stats poll failed, which read
// as an outage while the page underneath was showing good data (owner
// complaint, 2026-10-21).
//
// Now it stays silent unless nothing has refreshed for more than 60s
// (useLiveUpdatesPaused). Then it shows one small muted line:
// - the API asked this browser to slow down (429): "paused, resuming
//   shortly". Nothing at all while the WebSocket is streaming AND the page
//   renders socket values (useWsDrivenPage: dashboard, screener, events),
//   since that page is still live. Pages that read nothing from the socket
//   (the asset page) still get the line. No Retry button: it resumes on its
//   own.
// - the API is erroring or unreachable: a calm "showing the last data
//   received" plus a link to the status page. No status codes.
export function HealthBanner() {
  const { paused, kind } = useLiveUpdatesPaused();
  const { connected, wsDrivenPage } = useLive();

  if (!paused) return null;
  if (kind === "rate_limited" && connected && wsDrivenPage) return null;

  return (
    <div
      role="status"
      className="sticky top-[calc(var(--app-topbar-h)+env(safe-area-inset-top))] z-30 border-b border-hairline bg-canvas/80 backdrop-blur-md lg:top-[73px]"
    >
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-3 gap-y-1 px-5 py-1.5 font-mono text-[11px] tracking-[0.04em] text-text-muted sm:px-8 lg:px-12 xl:px-20">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-text-muted"
        />
        <span>
          {kind === "rate_limited"
            ? LIVE_PAUSED_INLINE
            : "Live updates paused. Showing the last data received."}
        </span>
        {kind !== "rate_limited" ? (
          <Link
            href="/status"
            className="ml-auto text-text-muted transition-colors duration-300 hover:text-text"
          >
            Status
          </Link>
        ) : null}
      </div>
    </div>
  );
}
