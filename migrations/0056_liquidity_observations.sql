-- Phase 0 "observe" for the tokens.xyz depth gate (Spec 04). Append-only
-- record of every liquidity tick — INCLUDING has_market=false / junk ticks
-- (stored as NULL) — so the Phase-1 floor is calibrated from the observed
-- distribution, not guessed. Indexer-only; not read by the engine.
CREATE TABLE liquidity_observations (
    asset         TEXT           NOT NULL REFERENCES assets(symbol),
    source        TEXT           NOT NULL,            -- 'tokens_xyz'
    liquidity_usd NUMERIC(30,18),                     -- NULL when has_market=false / junk tick
    has_market    BOOLEAN        NOT NULL,
    ts            TIMESTAMPTZ    NOT NULL,
    PRIMARY KEY (asset, source, ts)
);
SELECT create_hypertable('liquidity_observations', 'ts', chunk_time_interval => INTERVAL '1 day');
SELECT add_retention_policy('liquidity_observations', INTERVAL '90 days');
-- Pre-empts the Phase-1 freshness LATERAL (the slow-query class fixed for
-- intrinsics in migration 0052).
CREATE INDEX liquidity_observations_asset_ts_idx ON liquidity_observations (asset, ts DESC);
