"use client";

import { SWRConfig } from "swr";
import { errorRetryDelayMs } from "@/lib/api/swr-retry";

// Root SWR defaults (W3a hygiene pass). Shared config only — every hook keeps
// its own `refreshInterval` (and any other per-hook option), since options
// passed directly to `useSWR(key, fetcher, options)` always take precedence
// over this context's defaults. This just gives every SWR consumer in the app
// (marketing + product) sane, consistent network behavior without having to
// repeat it in each hook.
export function SwrConfigProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnReconnect: true,
        shouldRetryOnError: true,
        // 429-aware retry: honours Retry-After instead of hammering an
        // exhausted per-IP window every 5s (see lib/api/swr-retry.ts).
        onErrorRetry: (err, _key, _config, revalidate, { retryCount }) => {
          const delay = errorRetryDelayMs(err, retryCount);
          if (delay == null) return;
          setTimeout(() => revalidate({ retryCount }), delay);
        },
        dedupingInterval: 2_000,
        // Per-tab request budget (the API allows 60/min per IP, and an office
        // or carrier NAT shares one IP across many visitors). Measured
        // 2026-10-21: 11-16 requests a minute per open tab. The hooks now poll
        // at 30-60s and share keys, which brings every page to 6 or fewer a
        // minute. Polling already pauses while the tab is hidden
        // (`refreshWhenHidden` defaults to false). Focus revalidation is kept
        // but throttled to once per 30s, so tab-switching does not refire
        // every key each time.
        focusThrottleInterval: 30_000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
