// Postgres pool + idempotent upserts to the shared TimescaleDB.
//
// One pool per process, lazy-initialized (mirrors mcp-ts/src/db.ts). Writers are
// `ON CONFLICT ... DO UPDATE` on the natural PK (mirrors crates/indexer-rs/src/
// sinks/postgres.rs). ADR-0036: no `owner`/`authority` is ever written — the
// upsert column lists below are the ONLY columns these tables have.

import pg from "pg";

let _pool: pg.Pool | null = null;

export function pool(): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 30_000,
    });
  }
  return _pool;
}

export async function checkDb(): Promise<boolean> {
  try {
    await pool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export type LoopBasis = "typed" | "inferred_utilization" | "aggregate_only";
export type Coverage = "full" | "partial" | "aggregate" | "stale" | "unknown";

// One (asset, protocol) leverage rollup for `loop_exposure_snapshots`.
// `position_bucket` is a k-floored RANGE label ('<5'|'5-20'|'20-50'|'>50'),
// NEVER a raw count (ADR-0036 inv.7).
export interface LoopExposureRow {
  asset: string;
  protocol: string;
  collateral_usd: string | null;
  collateral_lev_usd: string | null;
  debt_usd: string | null;
  loop_basis: LoopBasis;
  position_bucket: string | null;
  coverage: Coverage;
  source_slot: number | null;
  ts: string; // RFC3339
}

export async function upsertLoopExposure(row: LoopExposureRow): Promise<void> {
  await pool().query(
    `INSERT INTO loop_exposure_snapshots
       (asset, protocol, collateral_usd, collateral_lev_usd, debt_usd,
        loop_basis, position_bucket, coverage, source_slot, ts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (asset, protocol, ts) DO UPDATE SET
       collateral_usd     = EXCLUDED.collateral_usd,
       collateral_lev_usd = EXCLUDED.collateral_lev_usd,
       debt_usd           = EXCLUDED.debt_usd,
       loop_basis         = EXCLUDED.loop_basis,
       position_bucket    = EXCLUDED.position_bucket,
       coverage           = EXCLUDED.coverage,
       source_slot        = EXCLUDED.source_slot`,
    [
      row.asset,
      row.protocol,
      row.collateral_usd,
      row.collateral_lev_usd,
      row.debt_usd,
      row.loop_basis,
      row.position_bucket,
      row.coverage,
      row.source_slot,
      row.ts,
    ],
  );
}

// Active (symbol, mint) pairs, so an adapter can join an on-chain mint (the
// canonical key protocols expose) back to a Pegana asset symbol — and only
// write rows that FK-resolve against `assets(symbol)`.
export interface TrackedAsset {
  symbol: string;
  mint: string;
}

export async function trackedAssets(): Promise<TrackedAsset[]> {
  const r = await pool().query<TrackedAsset>(
    `SELECT symbol, mint FROM assets WHERE is_active = TRUE`,
  );
  return r.rows;
}

// One k-floored HF band for `loop_hf_distribution` (ADR-0036 variant A). No
// position pubkeys, no owner — only aggregate band stats. The caller MUST have
// already dropped bands with count < k and suppressed single-position dominance.
export interface LoopHfBandRow {
  asset: string;
  protocol: string;
  hf_band: string;
  position_bucket: string; // k-floored range, never a raw count
  collateral_usd: string;
  debt_usd: string | null;
  liquidation_ltv: string;
  liquidation_bonus: string | null;
  source_slot: number | null;
  ts: string;
}

export async function upsertHfBand(row: LoopHfBandRow): Promise<void> {
  await pool().query(
    `INSERT INTO loop_hf_distribution
       (asset, protocol, hf_band, position_bucket, collateral_usd, debt_usd,
        liquidation_ltv, liquidation_bonus, source_slot, ts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (asset, protocol, hf_band, ts) DO UPDATE SET
       position_bucket   = EXCLUDED.position_bucket,
       collateral_usd    = EXCLUDED.collateral_usd,
       debt_usd          = EXCLUDED.debt_usd,
       liquidation_ltv   = EXCLUDED.liquidation_ltv,
       liquidation_bonus = EXCLUDED.liquidation_bonus,
       source_slot       = EXCLUDED.source_slot`,
    [
      row.asset,
      row.protocol,
      row.hf_band,
      row.position_bucket,
      row.collateral_usd,
      row.debt_usd,
      row.liquidation_ltv,
      row.liquidation_bonus,
      row.source_slot,
      row.ts,
    ],
  );
}
