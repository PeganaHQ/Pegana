-- web/tests/fixtures/e2e-seed.sql
--
-- CI-only seed for the backend-provisioned Playwright job (web-e2e.yml →
-- `e2e-backend`). NOT a migration — it lives outside migrations/ on purpose so
-- the CI migration glob never applies it to a real database.
--
-- What it makes meaningful (specs that otherwise pass-without-asserting or
-- skip when no backend is present):
--   * dashboard.spec.ts / smoke.spec.ts  — needs ≥2 asset rows with a state +
--     intrinsic/market USD so the asset list renders real rows (not just the
--     catalog) and the peek pane / sparkline have data.
--   * asset-detail.spec.ts / smoke.spec.ts — /asset/jitoSOL must surface
--     Intrinsic + Market USD values (the LATERAL join in /v1/assets/:symbol
--     reads the latest discount_snapshot, with intrinsic_snapshots as fallback).
--   * audit.spec.ts "detail page renders for a real alert_id" — gated on
--     PEGANA_SAMPLE_ALERT_ID; the new job sets it to the fixed UUID seeded
--     below so the test lights up. The detail page asserts a "methodology"
--     section + a state-transition arrow (from_state → to_state).
--
-- The assets themselves (jitoSOL, mSOL, bSOL, …) are already seeded by the
-- migrations (0002_seed_assets.sql et al), so this file only adds the
-- *time-series + receipt* rows the engine would normally write at runtime.
-- We can't run the live engine in CI (it needs mainnet RPC + Jupiter + Pyth),
-- so we synthesize a small, deterministic snapshot set instead.

BEGIN;

-- ── Latest snapshots for three major LSTs (PEGGED, tiny discount) ──────────
-- discount_snapshots is the primary source for /v1/assets{,/:symbol}: state,
-- discount_smooth, intrinsic_usd, market_usd all come from the latest row.
-- Two timestamps per asset give the 24h sparkline (discount_1m) something to
-- aggregate after we refresh the continuous aggregate.
INSERT INTO discount_snapshots
    (asset, discount_raw, discount_smooth, oracle_discount, state, confidence,
     intrinsic_usd, market_usd, ts)
VALUES
    ('jitoSOL', 0.0012, 0.0011, 0.0010, 'PEGGED', 'high',
     1.182000000000000000, 1.180700000000000000, now() - INTERVAL '10 minutes'),
    ('jitoSOL', 0.0009, 0.0010, 0.0009, 'PEGGED', 'high',
     1.182500000000000000, 1.181300000000000000, now()),
    ('mSOL', 0.0021, 0.0020, 0.0019, 'PEGGED', 'high',
     1.245000000000000000, 1.242500000000000000, now() - INTERVAL '10 minutes'),
    ('mSOL', 0.0018, 0.0019, 0.0018, 'PEGGED', 'high',
     1.245500000000000000, 1.243100000000000000, now()),
    ('bSOL', 0.0031, 0.0030, 0.0028, 'PEGGED', 'high',
     1.156000000000000000, 1.152500000000000000, now() - INTERVAL '10 minutes'),
    ('bSOL', 0.0027, 0.0029, 0.0026, 'PEGGED', 'high',
     1.156400000000000000, 1.153100000000000000, now())
ON CONFLICT (asset, ts) DO NOTHING;

-- ── Intrinsic-only fallback row (exercises the COALESCE path in assets.rs) ──
-- USDC has no discount snapshot here, so the list/detail query falls back to
-- the latest intrinsic_snapshots row → state 'UNKNOWN' with a NAV. Keeps the
-- "no swap needed" USDC exit-liquidity empty-state realistic.
INSERT INTO intrinsic_snapshots (asset, value_usd, source, ts)
VALUES ('USDC', 1.000000000000000000, 'e2e-seed', now())
ON CONFLICT (asset, source, ts) DO NOTHING;

-- ── One real receipt for the audit detail spec ────────────────────────────
-- Fixed UUID so the workflow can export PEGANA_SAMPLE_ALERT_ID without parsing
-- a generated id back out of the DB. from_state ≠ to_state so the page renders
-- the "→" transition arrow the spec asserts on.
INSERT INTO alerts
    (id, asset, class, from_state, to_state, discount, intrinsic_usd, market_usd,
     confidence, detected_at, payload)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'jitoSOL', 'lst',
     'PEGGED', 'DRIFT', 0.0085, 1.182500000000000000, 1.172400000000000000,
     'high', now() - INTERVAL '1 hour', '{"source":"e2e-seed"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO alert_evidence
    (alert_id, methodology_version, assets_toml_sha256, inputs_frozen, computed,
     receipt_sha256, commit_status)
VALUES
    ('11111111-1111-1111-1111-111111111111', '0.2.0',
     repeat('a', 64),
     '{"intrinsic_usd":"1.1825","market_usd":"1.1724","source":"e2e-seed"}'::jsonb,
     '{"discount":"0.0085","state":"DRIFT","deadband_pct":25}'::jsonb,
     repeat('b', 64), 'not_applicable')
ON CONFLICT (alert_id) DO NOTHING;

COMMIT;

-- Materialize the 1-minute continuous aggregate so the 24h sparkline
-- (series_24h in /v1/assets) has rows. Must run OUTSIDE the transaction above —
-- refresh_continuous_aggregate() cannot run inside a transaction block.
CALL refresh_continuous_aggregate('discount_1m', NULL, NULL);
