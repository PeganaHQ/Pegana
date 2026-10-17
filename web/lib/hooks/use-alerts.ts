"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";

// Consumers requesting the plain (unfiltered) global alert feed with a small
// row count (<=60) all fetch the SAME underlying data — just render different
// slices of it. Before this fix, dashboard-sidebar (10), live-alert-bubble
// (1), live-this-week (15) and asset-preview-pane (60) each opened their own
// independent 30s-interval SWR key/fetch of /v1/alerts, so the exact same
// feed was fetched up to 4x in parallel. Those consumers now share ONE SWR
// key (fetched at `limit=60`) and slice client-side to their own requested
// row count — same rendered rows, one fetch. Consumers that filter by
// `asset`/`since` (asset detail page, status page) or need more rows than the
// shared page (events, limit=500) fetch genuinely different data and are NOT
// eligible — they keep their own distinct SWR key exactly as before.
const SHARED_LIMIT = 60;
const SHARED_KEY = "alerts|shared-60";

export function useAlerts(opts?: {
  asset?: string;
  limit?: number;
  since?: string;
}) {
  const limit = opts?.limit;
  const shared =
    !opts?.asset && !opts?.since && limit != null && limit <= SHARED_LIMIT;

  const key = shared
    ? SHARED_KEY
    : ["alerts", JSON.stringify(opts ?? {})].join("|");
  const fetcher = shared
    ? () => api.alerts({ limit: SHARED_LIMIT })
    : () => api.alerts(opts);

  const swr = useSWR(key, fetcher, { refreshInterval: 30_000 });

  if (shared && swr.data) {
    return { ...swr, data: swr.data.slice(0, limit) };
  }
  return swr;
}
