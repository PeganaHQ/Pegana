"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";
import { historyStartMs } from "@/lib/asset/history-range";

/**
 * The asset's own history start (epoch ms) from /v1/assets/:symbol/state, for
 * chart coverage notes. Null while loading, on error, or when the API sends
 * none, and callers then fall back to the global start. It only moves if the
 * history is rebuilt, so it is fetched once per asset per session.
 */
export function useHistoryStart(symbol: string | null): number | null {
  const { data } = useSWR(
    symbol ? ["asset-history-start", symbol] : null,
    ([, sym]: [string, string]) => api.assetState(sym),
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
      dedupingInterval: 600_000,
    },
  );
  return historyStartMs(data?.history_start);
}
