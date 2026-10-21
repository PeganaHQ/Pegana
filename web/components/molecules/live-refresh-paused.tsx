"use client";

// Inline notice for a page that already shows real data (server-rendered or a
// previous poll) when its live refresh fails. It replaces the old behaviour of
// swapping the whole page for an outage screen on any single fetch error.
// Staleness of the reading itself is StaleBanner's job (keyed on updated_at);
// this only says the live refresh is not landing right now.
export function LiveRefreshPaused({ rateLimited }: { rateLimited: boolean }) {
  return (
    <div role="status" className="border-b border-hairline bg-canvas">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 font-mono text-[11px] tracking-[0.04em] sm:px-6">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-text-muted"
        />
        <span className="uppercase text-text">live refresh paused</span>
        <span className="text-text-muted">
          {rateLimited
            ? "Rate limited: this network used its 60 requests a minute. Retrying automatically."
            : "The last refresh failed. Showing the last reading received, retrying automatically."}
        </span>
      </div>
    </div>
  );
}
