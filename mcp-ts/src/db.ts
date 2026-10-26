// Postgres pool + minimal query helpers.
//
// One pool per process, lazy-initialized. History reads the 1-minute
// continuous aggregate and samples the USD legs for each returned bucket.

import pg from "pg";
import { normalizeDecimal, roundDecimal } from "@/shared/decimal";

let _pool: pg.Pool | null = null;

export function pool(): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
      statement_timeout: 5_000,
    });
  }
  return _pool;
}

export type HistoryBucket = "1m" | "5m" | "15m" | "1h";

export interface HistoryRow {
  ts: string;
  discount: string;
  /** Last raw observation in the bucket; null when the bucket has none. */
  intrinsic_usd: string | null;
  market_usd: string | null;
}

// Time-series of (intrinsic, market, discount) for an asset, bucketed.
// Returns most-recent first. The lookback is at most seven days.
type Queryable = Pick<pg.Pool, "query"> & Partial<Pick<pg.Pool, "waitingCount">>;

/** Fail fast instead of queueing once this many history reads already wait for a connection. */
export const MAX_WAITING_CLIENTS = 20;

/** Raised when the pool is saturated, so the tool can say "retry" without driver text. */
export class HistoryOverloadError extends Error {
  constructor() {
    super("history reads are overloaded");
    this.name = "HistoryOverloadError";
  }
}

/** True for a query timeout (57014) or a pool connection timeout. */
export function isOverloadError(e: unknown): boolean {
  if (e instanceof HistoryOverloadError) return true;
  const err = e as { code?: unknown; message?: unknown } | null;
  return (
    err?.code === "57014" ||
    (typeof err?.message === "string" &&
      /timeout exceeded when trying to connect/i.test(err.message))
  );
}

export async function fetchHistory(
  asset: string,
  bucket: HistoryBucket,
  limit: number,
  db: Queryable = pool(),
): Promise<HistoryRow[]> {
  if ((db.waitingCount ?? 0) > MAX_WAITING_CLIENTS) throw new HistoryOverloadError();
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 5_000);
  // `discount_1m` stores the smoothed discount, but not the USD legs. Fetch
  // the last raw USD observation only for each selected output bucket.
  //
  // Output formats match REST (R1 audit idx 80): `ts` is RFC 3339 / ISO-8601
  // UTC with milliseconds (`2026-10-21T01:25:00.000Z`, not the Postgres text
  // form `2026-10-21 01:25:00+00`); the bucket-average discount is rounded to
  // the 6 dp discount_* columns store, and every decimal is trailing-zero
  // normalized like rust_decimal's normalize().
  const result = await db.query<HistoryRow>(
    `WITH grouped AS (
       SELECT time_bucket($1::interval, bucket) AS bucket,
              ROUND(AVG(avg_discount), 6)::text AS discount
       FROM discount_1m
       WHERE asset = $2
         AND bucket > now() - LEAST($3::int * $1::interval, interval '7 days')
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT $3
     )
     SELECT
       to_char(grouped.bucket AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ts,
       grouped.discount,
       legs.intrinsic_usd::text AS intrinsic_usd,
       legs.market_usd::text AS market_usd
     FROM grouped
     LEFT JOIN LATERAL (
       SELECT intrinsic_usd, market_usd
       FROM discount_snapshots
       WHERE asset = $2 AND ts >= grouped.bucket
         AND ts < grouped.bucket + $1::interval
       ORDER BY ts DESC
       LIMIT 1
     ) legs ON true
     ORDER BY grouped.bucket DESC`,
    [bucket, asset, safeLimit],
  );
  return result.rows.map((r) => ({
    ts: r.ts,
    discount: normalizeDecimal(r.discount),
    intrinsic_usd: r.intrinsic_usd == null ? null : roundDecimal(r.intrinsic_usd, 18),
    market_usd: r.market_usd == null ? null : roundDecimal(r.market_usd, 18),
  }));
}
