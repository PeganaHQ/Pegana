"use client";
import { useHistoryRange } from "@/lib/hooks/use-history-range";
import type { HistoryPoint } from "@/lib/api/types";

// 5000 minutes — matches the API's single-call limit cap.
const WINDOW_MS = 5000 * 60 * 1000;
// Safety cap: covers ~34 days (well past the 30-day strip).
const MAX_WINDOWS = 10;
// How far back the 30-day strip shows.
const STRIP_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Pure fetcher — exported so it can be unit-tested without SWR/network.
 * `apiFn` has the same signature as `api.assetHistory`; tests inject a mock.
 */
export async function fetchHistory30d(
  symbol: string,
  apiFn: (
    sym: string,
    opts: { bucket: "1m"; from: string; to: string; limit: number },
  ) => Promise<HistoryPoint[]>,
): Promise<HistoryPoint[]> {
  const cutoff = new Date(Date.now() - STRIP_MS);
  let windowTo = new Date();
  const all: HistoryPoint[] = [];

  for (let i = 0; i < MAX_WINDOWS; i++) {
    const windowFrom = new Date(windowTo.getTime() - WINDOW_MS);

    const rows = await apiFn(symbol, {
      bucket: "1m",
      from: windowFrom.toISOString(),
      to: windowTo.toISOString(),
      limit: 5000,
    });

    if (rows.length === 0) {
      // No data in this window — we've passed the asset's first data point.
      break;
    }

    all.push(...rows);

    // Rows are newest-first; the last row is the oldest.
    const oldestTs = rows[rows.length - 1].ts;
    windowTo = new Date(Date.parse(oldestTs) - 1000);

    // No need to page further back than the strip shows.
    if (windowFrom <= cutoff) {
      break;
    }
  }

  return all;
}

/**
 * The 30-day strip's history. Shares the asset chart's 30D range (same SWR
 * key, see use-history-range.ts), so opening the strip and the 30D chart costs
 * one paged load, not two. The range is averaged to 1-hour buckets that keep
 * the worst state seen in each hour, which is all the per-day strip reads.
 */
export function useHistory30d(symbol: string | null): {
  data?: HistoryPoint[];
  error?: unknown;
} {
  const { data, error } = useHistoryRange(symbol, "30d");
  return { data: data?.points, error };
}
