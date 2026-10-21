import type { HistoryPoint, PegState } from "@/lib/api/types";
import { isPlausibleDiscount } from "@/lib/api/format";
import { BUCKET_RANGE_MS, type ChartBucket } from "./chart-bucket";

/**
 * Where Pegana's stored history begins.
 *
 * The production box was rebuilt with a fresh database on 2026-10-17. The
 * first one-minute row after the rebuild is 2026-10-17T09:20:00Z. Receipts from
 * 2026-05-27 to 2026-08-26 were restored into the ledger, but no discount
 * history exists before this instant, and nothing at all exists between
 * 2026-08-26 and 2026-10-17. Any chart range that reaches further back must say
 * so instead of looking like a quiet, empty period.
 */
export const HISTORY_BEGINS_AT = "2026-10-17T09:20:00Z";
export const HISTORY_BEGINS_MS = Date.parse(HISTORY_BEGINS_AT);

/** The API's per-call row cap on /history (OpenAPI: limit clamps to 5000). */
export const HISTORY_PAGE_LIMIT = 5000;

/**
 * How each chart range is loaded.
 *
 * The API has two buckets, raw and 1m, and returns rows newest first with no
 * cursor beyond `to`. 7D and 30D used to ask for ONE page of 2000 one-minute
 * rows, which is the newest ~33 hours: both ranges showed the same 33h window
 * under a 7D or 30D label. They now page backwards with `to` until the range
 * start is covered, then average into 5-minute (7D, about 2016 points) or
 * 1-hour (30D, about 720 points) buckets so the chart stays light.
 */
export interface RangePlan {
  bucket: "raw" | "1m";
  /** Rows per call. */
  limit: number;
  /** Max calls. 1 for the short ranges. */
  maxPages: number;
  /** Client-side averaging step, or null to keep the API rows as they are. */
  stepSec: number | null;
}

export const RANGE_PLAN: Record<ChartBucket, RangePlan> = {
  "1h": { bucket: "raw", limit: 2000, maxPages: 1, stepSec: null },
  "24h": { bucket: "1m", limit: 2000, maxPages: 1, stepSec: null },
  // 7 x 1440 = 10080 minutes: two full pages and a short third.
  "7d": { bucket: "1m", limit: HISTORY_PAGE_LIMIT, maxPages: 3, stepSec: 300 },
  // 30 x 1440 = 43200 minutes: eight full pages and a short ninth.
  "30d": { bucket: "1m", limit: HISTORY_PAGE_LIMIT, maxPages: 9, stepSec: 3600 },
};

export type HistoryFetcher = (
  symbol: string,
  opts: { bucket: "raw" | "1m"; from: string; to?: string; limit: number },
) => Promise<HistoryPoint[]>;

export interface RangeResult {
  /** Newest first, like the API. */
  points: HistoryPoint[];
  /** Range start the caller asked for (epoch ms). */
  fromMs: number;
  /** True when a page cap stopped paging before `fromMs` was reached. */
  truncated: boolean;
}

/**
 * Load one chart range. Pages backwards with `to` (newest first) until a page
 * comes back short, the oldest row reaches the range start, or the plan's page
 * cap is hit. `maxPages` overrides the plan, for multi-series surfaces that
 * must keep their request count down.
 */
export async function fetchHistoryRange(
  symbol: string,
  range: ChartBucket,
  fetcher: HistoryFetcher,
  opts: { nowMs?: number; maxPages?: number } = {},
): Promise<RangeResult> {
  const plan = RANGE_PLAN[range];
  const nowMs = opts.nowMs ?? Date.now();
  const fromMs = nowMs - BUCKET_RANGE_MS[range];
  const from = new Date(fromMs).toISOString();
  const maxPages = Math.max(1, opts.maxPages ?? plan.maxPages);

  const all: HistoryPoint[] = [];
  let to: string | undefined;
  let truncated = false;
  for (let page = 0; page < maxPages; page++) {
    const rows = await fetcher(symbol, {
      bucket: plan.bucket,
      from,
      ...(to ? { to } : {}),
      limit: plan.limit,
    });
    all.push(...rows);
    if (rows.length < plan.limit) break;
    const oldest = Date.parse(rows[rows.length - 1].ts);
    if (!Number.isFinite(oldest) || oldest <= fromMs) break;
    if (page === maxPages - 1) {
      truncated = true;
      break;
    }
    to = new Date(oldest - 1000).toISOString();
  }

  const points =
    plan.stepSec != null ? downsampleHistory(all, plan.stepSec) : all;
  return { points, fromMs, truncated };
}

const STATE_RANK: Record<PegState, number> = {
  PEGGED: 0,
  UNKNOWN: 1,
  DRIFT: 2,
  DEPEG: 3,
  CRITICAL: 4,
  BLACK_SWAN: 5,
};

/**
 * Average one-minute rows into `stepSec` buckets: mean discount over the
 * plausible samples, the worst state seen in the bucket (so a short excursion
 * is never averaged away from the state record), timestamp = bucket start.
 * Output is newest first, matching the API.
 */
export function downsampleHistory(
  points: HistoryPoint[],
  stepSec: number,
): HistoryPoint[] {
  const stepMs = stepSec * 1000;
  const buckets = new Map<
    number,
    { sum: number; n: number; state: PegState }
  >();
  for (const p of points) {
    const t = Date.parse(p.ts);
    if (!Number.isFinite(t)) continue;
    const key = Math.floor(t / stepMs) * stepMs;
    const b = buckets.get(key) ?? { sum: 0, n: 0, state: p.state };
    if (STATE_RANK[p.state] > STATE_RANK[b.state]) b.state = p.state;
    if (isPlausibleDiscount(p.discount)) {
      b.sum += parseFloat(p.discount);
      b.n += 1;
    }
    buckets.set(key, b);
  }
  return [...buckets.entries()]
    .filter(([, b]) => b.n > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([key, b]) => ({
      ts: new Date(key).toISOString(),
      discount: String(b.sum / b.n),
      state: b.state,
    }));
}

/**
 * The note a chart shows when its range reaches before the data it has.
 *
 * - `null` when the loaded data covers the range (within one sample step).
 * - Otherwise a plain sentence naming where the data starts, plus the
 *   history-start fact when the range reaches back past it.
 * - A page cap that stopped paging early is stated as such.
 *
 * `assetHistoryStartMs` is the asset's own first stored row (`history_start`
 * on /v1/assets/:symbol/state). Assets added after the 2026-10-17 rebuild
 * start later (the LST cohort on 2026-10-20 10:50Z), so citing the global
 * HISTORY_BEGINS_AT for them was false. Unknown (still loading, or the API
 * did not send it), the global start is the fallback.
 */
export function historyCoverageNote(
  points: Pick<HistoryPoint, "ts">[],
  fromMs: number,
  truncated = false,
  assetHistoryStartMs: number | null = null,
): string | null {
  const own =
    assetHistoryStartMs != null && Number.isFinite(assetHistoryStartMs);
  const beginsMs = own
    ? Math.max(assetHistoryStartMs as number, HISTORY_BEGINS_MS)
    : HISTORY_BEGINS_MS;
  const beginsText = own
    ? `Pegana's history for this asset begins ${formatUtc(beginsMs)}.`
    : `Pegana's stored history begins ${formatUtc(beginsMs)}.`;
  if (points.length === 0) {
    return fromMs < beginsMs ? `No data in this range. ${beginsText}` : null;
  }
  let oldest = Infinity;
  for (const p of points) {
    const t = Date.parse(p.ts);
    if (Number.isFinite(t) && t < oldest) oldest = t;
  }
  if (!Number.isFinite(oldest)) return null;
  // One hour of slack: the coarsest step is 1h, and a range start that falls
  // inside the first bucket is still covered.
  if (oldest - fromMs <= 3600_000) return null;
  // An hourly bucket is stamped at the top of its hour, so the first one can
  // read earlier than the first stored row (10:00 against a 10:50 start).
  // Never claim data from before the history begins.
  const since = `Showing data from ${formatUtc(Math.max(oldest, beginsMs))}.`;
  if (truncated) {
    return `${since} Older data in this range was not loaded.`;
  }
  if (fromMs < beginsMs) {
    return `${since} ${beginsText}`;
  }
  return since;
}

/** `history_start` (ISO) as epoch ms; null when absent or unparseable. */
export function historyStartMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** "2026-10-17 09:20 UTC". */
export function formatUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
