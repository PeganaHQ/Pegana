"use client";
import useSWR from "swr";
import { api } from "@/lib/api/client";
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
 * SWR hook that paginates the 1m history to cover the full tracked window
 * (up to 30 days) rather than the single-call ceiling of ~3.47 days.
 */
export function useHistory30d(symbol: string | null): {
  data?: HistoryPoint[];
  error?: unknown;
} {
  // SWR key must be a stable primitive (no objects) so cache identity is reliable.
  return useSWR(symbol ? ["history-30d", symbol] : null, ([, sym]) =>
    fetchHistory30d(sym, (s, opts) => api.assetHistory(s, opts)),
  );
}
