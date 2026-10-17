// Pure, dependency-free bucket-window math shared between `AssetChart` (which
// pulls in lightweight-charts) and callers that need to reason about the
// chart's loaded time domain WITHOUT mounting it — e.g. the activity timeline
// on the History tab pre-checking a scrub target before switching to Overview.
//
// Kept out of asset-chart.tsx on purpose: that module is dynamically
// imported with `ssr:false` to keep lightweight-charts off the initial JS
// payload, so anything imported statically from the page must live here
// instead, or the dynamic-import bundle split is defeated.

export type ChartBucket = "1h" | "24h" | "7d" | "30d";

export const CHART_BUCKETS = [
  "1h",
  "24h",
  "7d",
  "30d",
] as const satisfies readonly ChartBucket[];

/** localStorage key `usePersistedMode` writes the chart's bucket under. */
export const CHART_BUCKET_STORAGE_KEY = "pegana.assetChart.bucket.v1";

/** Total window (ms) each bucket loads — the single source of truth for both
 *  the chart's history fetch and the timeline-scrub boundary check, so the
 *  two can never drift apart. */
export const BUCKET_RANGE_MS: Record<ChartBucket, number> = {
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
};

/** Best-effort peek at the persisted chart bucket. Falls back to the
 *  component's own default ("24h") when unavailable, invalid, or on the
 *  server. Never mounts the chart — safe to call from a sibling tab. */
export function readPersistedBucket(): ChartBucket {
  if (typeof window === "undefined") return "24h";
  try {
    const raw = window.localStorage.getItem(CHART_BUCKET_STORAGE_KEY);
    return raw === "1h" || raw === "24h" || raw === "7d" || raw === "30d"
      ? raw
      : "24h";
  } catch {
    return "24h";
  }
}

/** The `[minSec, maxSec]` time domain the chart currently loads for a given
 *  bucket — i.e. what a timestamp must fall inside for `scrubTo` to succeed.
 *  Pure so callers on a DIFFERENT tab (where the chart isn't mounted) can
 *  pre-check a target before switching tabs, without expanding the fetch to
 *  cover it. */
export function loadedRangeForBucket(
  bucket: ChartBucket,
  nowMs = Date.now(),
): { minSec: number; maxSec: number } {
  const ms = BUCKET_RANGE_MS[bucket];
  return {
    minSec: Math.floor((nowMs - ms) / 1000),
    maxSec: Math.floor(nowMs / 1000),
  };
}

/** Half-width (seconds) of the scrub window for a bucket: a quarter of the
 *  bucket's total span each side, so the 24h view opens a 12h window (the
 *  ±6h spec example) and the 1h view opens a tight 30-min window. */
export function scrubHalfWidthSeconds(bucket: ChartBucket): number {
  return Math.round(BUCKET_RANGE_MS[bucket] / 1000 / 4);
}
