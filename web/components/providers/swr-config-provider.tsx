"use client";

import { SWRConfig } from "swr";

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
        errorRetryCount: 3,
        errorRetryInterval: 5_000,
        dedupingInterval: 2_000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
