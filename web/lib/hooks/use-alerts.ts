"use client";
import useSWR from "swr";
import { api, type AlertsQuery } from "@/lib/api/client";

// Consumers requesting the plain (unfiltered) global feed with a small row
// count (<=60) all fetch the SAME underlying data and render different slices
// of it, so they share ONE SWR key (fetched at `limit=60`) and slice
// client-side. Consumers that filter server-side (asset, since, excludePegged)
// fetch genuinely different data and keep their own key.
const SHARED_LIMIT = 60;
const SHARED_KEY = "alerts|shared-60";

export function useAlerts(opts?: {
  asset?: string;
  limit?: number;
  since?: string;
  excludePegged?: boolean;
}) {
  const limit = opts?.limit;
  const shared =
    !opts?.asset &&
    !opts?.since &&
    opts?.excludePegged == null &&
    limit != null &&
    limit <= SHARED_LIMIT;

  const key = shared
    ? SHARED_KEY
    : ["alerts", JSON.stringify(opts ?? {})].join("|");
  const query: AlertsQuery | undefined = opts;
  const fetcher = shared
    ? () => api.alerts({ limit: SHARED_LIMIT })
    : () => api.alerts(query);

  const swr = useSWR(key, fetcher, { refreshInterval: 30_000 });

  if (shared && swr.data) {
    return { ...swr, data: swr.data.slice(0, limit) };
  }
  return swr;
}

/** Full window by server-side paging; see `api.alertsWindow`. */
export function useAlertsWindow(opts: { since: string; maxPages?: number }) {
  return useSWR(
    ["alerts-window", opts.since, opts.maxPages ?? 10].join("|"),
    () => api.alertsWindow(opts),
    { refreshInterval: 60_000 },
  );
}
