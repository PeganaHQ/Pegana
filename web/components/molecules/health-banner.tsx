"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";
import { useStats } from "@/lib/hooks/use-stats";

// Single global banner that surfaces upstream health for the whole site.
// Replaces the historical per-block "API unreachable" repetition: data blocks
// can show skeletons + last-known snapshot while this banner is the single
// source of truth for "what's wrong + how to recover."
export function HealthBanner() {
  const { error, isLoading, data } = useStats();
  const { mutate } = useSWRConfig();
  const [retrying, setRetrying] = useState(false);
  const [downSince, setDownSince] = useState<number | null>(null);

  // Track how long the API has been unhealthy so the banner can show
  // "down for X min" rather than a static line that's identical at second 1
  // and minute 10.
  useEffect(() => {
    if (error && downSince == null) setDownSince(Date.now());
    if (!error && data && downSince != null) setDownSince(null);
  }, [error, data, downSince]);

  if (isLoading && !error) return null;
  if (!error) return null;

  const status = (error as { status?: number } | undefined)?.status;
  const isHttpError = typeof status === "number";
  const mins = downSince
    ? Math.max(0, Math.round((Date.now() - downSince) / 60_000))
    : 0;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      // Revalidate every SWR cache entry. Cheap — useSWR de-dupes, and the
      // retry button is rarely clicked. Resolves the "stale skeleton" cluster
      // in one tap.
      await mutate(() => true, undefined, { revalidate: true });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      role="alert"
      className="sticky top-[calc(var(--app-topbar-h)+env(safe-area-inset-top))] z-30 border-b border-st-drift/40 bg-canvas/90 backdrop-blur-md lg:top-[57px]"
    >
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 font-mono text-[11px] tracking-[0.04em] text-st-drift sm:px-8 lg:px-12 xl:px-20">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-st-drift"
        />
        <span className="uppercase">live feed</span>
        <span className="text-text-muted">·</span>
        <span className="text-text">
          {isHttpError ? `API responded ${status}` : "API unreachable"}
          {mins > 0 ? ` for ${mins} min` : ""}
          {/* Conditional on there actually BEING last-known data. The sentence
              used to be unconditional, so on a first visit during an outage —
              empty SWR cache, nothing ever fetched — the banner promised a
              cached snapshot while the page directly beneath it rendered
              "LIVE FEED UNREACHABLE" with zero rows. Two contradictory claims
              in one viewport, and the reassuring one was the false one. For a
              peg oracle, asserting you are showing data you do not have is the
              exact failure the product exists to prevent. */}
          {data ? ". Showing last known data." : ". No data loaded."}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1.5 border border-hairline px-2 py-[3px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:border-outline hover:text-text disabled:opacity-50"
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
          <Link
            href="/status"
            className="inline-flex items-center gap-1 text-text-muted transition-colors duration-300 hover:text-text"
          >
            Status
            <IconArrowRight size={11} />
          </Link>
        </div>
      </div>
    </div>
  );
}
