-- 0070 — Sub-C "Loop Intelligence" (ADR-0036 variant A: distribution-only, anonymous).
--
-- Two Timescale hypertables that materialize cross-protocol leverage data for the
-- depeg-cascade simulator (`/v1/assets/:symbol/loop-exposure` + `.../simulate-depeg`).
-- These are ADVISORY analytics — never a receipt input, no methodology bump.
--
-- ADR-0036 invariants baked into the schema:
--   • NO `owner`/`authority` column — the decoded obligation owner pubkey is present
--     on every anonymously-enumerated obligation and MUST be dropped, not persisted
--     (invariant 1b). CI asserts no owner-capable column exists here.
--   • `position_bucket` is a k-floored RANGE label ('<5'|'5-20'|'20-50'|'>50'),
--     NEVER a raw integer count (invariant 7).
--   • `loop_hf_distribution` stores aggregate HF-band distributions, NOT per-position
--     rows — the original `loop_positions` table is deliberately NOT created (variant A).
--   • Position pubkeys are discarded by the indexer after each rollup — nothing here
--     can be joined back to an identity.

-- ── Per (asset, protocol) leverage rollup — the materialized loop_exposure_usd. ──────
CREATE TABLE IF NOT EXISTS loop_exposure_snapshots (
    asset               TEXT NOT NULL REFERENCES assets(symbol),
    protocol            TEXT NOT NULL,                 -- 'kamino' | 'jupiter_lend' | 'marginfi' | 'save'
    collateral_usd      NUMERIC(30,18),                -- asset supplied as collateral (all positions)
    collateral_lev_usd  NUMERIC(30,18),                -- ...of which in LEVERAGE/loop positions
    debt_usd            NUMERIC(30,18),                -- asset borrowed (shorted)
    loop_basis          TEXT NOT NULL,                 -- 'typed' | 'inferred_utilization' | 'aggregate_only'
    position_bucket     TEXT,                          -- ADR-0036 inv.7: k-floored RANGE, NEVER a raw count
    coverage            TEXT NOT NULL,                 -- 'full' | 'partial' | 'aggregate' | 'stale' | 'unknown'
    source_slot         BIGINT,
    ts                  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (asset, protocol, ts)
);
SELECT create_hypertable('loop_exposure_snapshots', 'ts', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_retention_policy('loop_exposure_snapshots', INTERVAL '180 days', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS loop_exposure_asset_ts_idx ON loop_exposure_snapshots (asset, ts DESC);

-- ── Aggregate HF-BAND distribution (ADR-0036 variant A) — the cascade model reads this. ──
-- Anonymously-enumerated obligations are folded into k-floored bands each sweep and the
-- pubkeys discarded (invariants 1, 2, 7). NO position pubkeys, NO owner field.
CREATE TABLE IF NOT EXISTS loop_hf_distribution (
    asset               TEXT NOT NULL REFERENCES assets(symbol),   -- collateral asset
    protocol            TEXT NOT NULL,
    hf_band             TEXT NOT NULL,                 -- '<1.0'|'1.0-1.05'|'1.05-1.1'|'1.1-1.25'|'>1.25'
    position_bucket     TEXT NOT NULL,                 -- inv.7 k-floored range; ROW OMITTED entirely if count < k (=5)
    collateral_usd      NUMERIC(30,18) NOT NULL,       -- SUM over the band (band SUPPRESSED if one position holds > ~45%, l-diversity)
    debt_usd            NUMERIC(30,18),
    liquidation_ltv     NUMERIC(10,6) NOT NULL,        -- representative liquidation threshold for the band
    liquidation_bonus   NUMERIC(10,6),
    source_slot         BIGINT,
    ts                  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (asset, protocol, hf_band, ts)
);
SELECT create_hypertable('loop_hf_distribution', 'ts', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
SELECT add_retention_policy('loop_hf_distribution', INTERVAL '180 days', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS loop_hf_dist_asset_ts_idx ON loop_hf_distribution (asset, ts DESC);
