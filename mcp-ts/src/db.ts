// Postgres pool + minimal query helpers.
//
// One pool per process, lazy-initialized. The TimescaleDB `time_bucket`
// aggregation is used to roll up `discount_snapshots` into the
// per-bucket series the agent client expects.

import pg from "pg";

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
export async function fetchHistory(
  asset: string,
  bucket: HistoryBucket,
  limit: number,
): Promise<HistoryRow[]> {
  const safeLimit = Math.min(Math.max(1, limit), 50_000);
  // Canonical column name in discount_snapshots is `discount_smooth`
  // (EWMA-smoothed value the engine writes after hysteresis). Mirrors
  // `crates/api-rs/src/routes/assets.rs` which aliases the same column
  // to `discount` in its `/v1/assets/{symbol}/history` response.
  const result = await pool().query<HistoryRow>(
    `SELECT
       time_bucket($1::interval, ts)::text AS ts,
       AVG(discount_smooth)::text AS discount,
       AVG(intrinsic_usd)::text AS intrinsic_usd,
       AVG(market_usd)::text AS market_usd
     FROM discount_snapshots
     WHERE asset = $2 AND ts > now() - interval '30 days'
     GROUP BY 1
     ORDER BY 1 DESC
     LIMIT $3`,
    [bucket, asset, safeLimit],
  );
  return result.rows;
}
