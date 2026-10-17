-- M16: TimescaleDB columnar compression on the three high-volume hypertables.
--
-- SAFETY: compression only — no rows are deleted, no retention/drop_chunks added.
-- Old chunks remain fully queryable after compression (transparent decompression
-- on SELECT).  The 7-day policy compresses chunks older than 7 days; anything
-- within the hot window stays uncompressed and writable.
--
-- Tables in scope (all partitioned on `ts`, all have an `asset` column):
--   discount_snapshots    — created in 0001_initial.sql:89
--   intrinsic_snapshots   — created in 0001_initial.sql:52
--   liquidity_observations — created in 0056_liquidity_observations.sql:5
--
-- NOT touched: alert_evidence, alert_evidence_pending, retractions,
--   methodology_versions, engine_state_snapshot, webhook_* (audit/trust tables).
--
-- Idempotency: ALTER TABLE ... SET (timescaledb.compress ...) is idempotent on
-- re-run (sets the same options).  add_compression_policy(..., if_not_exists =>
-- TRUE) is a no-op when the policy already exists.

-- ── discount_snapshots ──────────────────────────────────────────────────────
ALTER TABLE discount_snapshots SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'asset',
    timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('discount_snapshots', INTERVAL '7 days', if_not_exists => TRUE);

-- ── intrinsic_snapshots ─────────────────────────────────────────────────────
ALTER TABLE intrinsic_snapshots SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'asset',
    timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('intrinsic_snapshots', INTERVAL '7 days', if_not_exists => TRUE);

-- ── liquidity_observations ──────────────────────────────────────────────────
ALTER TABLE liquidity_observations SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'asset',
    timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('liquidity_observations', INTERVAL '7 days', if_not_exists => TRUE);
