// Postgres pool + minimal query helpers.
//
// One pool per process, lazy-initialized. The TimescaleDB `time_bucket`
// aggregation is used to roll up `discount_snapshots` into the
// per-bucket series the agent client expects.

import pg from "pg";
import { normalizeDecimal, roundDecimal } from "@/shared/decimal";

let _pool: pg.Pool | null = null;

export function pool(): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return _pool;
}

export type HistoryBucket = "1m" | "5m" | "15m" | "1h";

export interface HistoryRow {
  ts: string;
  discount: string;
  intrinsic_usd: string;
  market_usd: string;
}

// Time-series of (intrinsic, market, discount) for an asset, bucketed.
// Returns most-recent first. Caps at 50k rows regardless of `limit` to
// keep payloads bounded.
type Queryable = Pick<pg.Pool, "query">;

export async function fetchHistory(
  asset: string,
  bucket: HistoryBucket,
  limit: number,
  db: Queryable = pool(),
): Promise<HistoryRow[]> {
  const safeLimit = Math.min(Math.max(1, limit), 50_000);
  // Canonical column name in discount_snapshots is `discount_smooth`
  // (EWMA-smoothed value the engine writes after hysteresis). Mirrors
  // `crates/api-rs/src/routes/assets.rs` which aliases the same column
  // to `discount` in its `/v1/assets/{symbol}/history` response.
  //
  // Output formats match REST (R1 audit idx 80): `ts` is RFC 3339 / ISO-8601
  // UTC with milliseconds (`2026-10-21T01:25:00.000Z`, not the Postgres text
  // form `2026-10-21 01:25:00+00`); the bucket-average discount is rounded to
  // the 6 dp discount_* columns store, and every decimal is trailing-zero
  // normalized like rust_decimal's normalize(). GROUP/ORDER BY 1 on the ISO
  // string is the same grouping and the same chronological order as on the
  // bucket itself (fixed-width UTC format).
  const result = await db.query<HistoryRow>(
    `SELECT
       to_char(time_bucket($1::interval, ts) AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ts,
       ROUND(AVG(discount_smooth), 6)::text AS discount,
       AVG(intrinsic_usd)::text AS intrinsic_usd,
       AVG(market_usd)::text AS market_usd
     FROM discount_snapshots
     WHERE asset = $2 AND ts > now() - interval '30 days'
     GROUP BY 1
     ORDER BY 1 DESC
     LIMIT $3`,
    [bucket, asset, safeLimit],
  );
  return result.rows.map((r) => ({
    ts: r.ts,
    discount: normalizeDecimal(r.discount),
    intrinsic_usd: roundDecimal(r.intrinsic_usd, 18),
    market_usd: roundDecimal(r.market_usd, 18),
  }));
}
