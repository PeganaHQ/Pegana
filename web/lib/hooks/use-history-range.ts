"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";
import type { ChartBucket } from "@/lib/asset/chart-bucket";
import { fetchHistoryRange, type RangeResult } from "@/lib/asset/history-range";

/**
 * History for one chart range, keyed by symbol + range only.
 *
 * The key holds no timestamp on purpose. The asset page prefetches the 24h
 * window and the chart loads it again once its dynamic import mounts; both
 * used to build `from = now - 24h` on their own, so the two keys differed by a
 * few milliseconds and SWR fetched the same window twice on every asset-page
 * load (measured 2026-10-21). The window is computed when the fetch runs.
 *
 * `maxPages` caps paging for multi-series surfaces (compare overlays up to four
 * assets) and is part of the key, since a capped result is a different result.
 */
export function useHistoryRange(
  symbol: string | null,
  range: ChartBucket,
  opts?: { maxPages?: number },
) {
  const maxPages = opts?.maxPages;
  return useSWR<RangeResult>(
    symbol ? ["history-range", symbol, range, maxPages ?? "plan"] : null,
    ([, sym]: [string, string]) =>
      fetchHistoryRange(sym, range, (s, o) => api.assetHistory(s, o), {
        maxPages,
      }),
    // The window is relative (now minus range), but refetching it (up to
    // several paged requests) every time the tab regains focus buys nothing.
    { revalidateOnFocus: false },
  );
}
