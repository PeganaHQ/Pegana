-- migrations/0035_engine_state_snapshot.sql
--
-- Engine in-memory state durability per ADR-0010.
--
-- The engine holds mutable state per asset:
--   ewma_discount, candidate_state, candidate_since, last_state.
--
-- On restart (deploy, crash, OOM, machine reboot), this state was wiped
-- pre-ADR-0010. Consequences:
--   * EWMA needed ~30 ticks to converge from None again, biasing the
--     calibration window (ADR-0005 puts Phase 3 in prod 2026-06-01, so a
--     single mid-window restart could skew the launch verdict per ADR-0001).
--   * candidate_since reset; in-flight hysteresis lost.
--
-- This table persists one row per asset, upserted every successful
-- recompute cycle (in-band with alert_evidence INSERT when an alert
-- fires; otherwise after every transition() call). On startup,
-- EngineState::load_from_pg(pool) hydrates the cache from this table.
--
-- The receipt schema (defined in pegana-methodology::receipt) already
-- captures ewma_prev, candidate_state, candidate_since in InputsFrozen —
-- this table is just the live-system equivalent, not a replay input.
--
-- ADR reference: docs/adr/0010-engine-state-snapshot.md

CREATE TABLE engine_state_snapshot (
    asset            TEXT        PRIMARY KEY,
    ewma_discount    NUMERIC,
    candidate_state  TEXT,
    candidate_since  TIMESTAMPTZ,
    last_state       TEXT        NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE engine_state_snapshot IS
    'Durable cache of engine in-memory state. Upserted per recompute cycle, '
    'hydrated on startup via EngineState::load_from_pg. Manual reset: '
    'TRUNCATE engine_state_snapshot — useful after a methodology bump that '
    'invalidates cache semantics (per ADR-0010).';

COMMENT ON COLUMN engine_state_snapshot.last_state IS
    'Stored as TEXT (not peg_state enum) because the methodology crate''s '
    'pegana_common::PegState serializes as String; keeping TEXT here avoids '
    'a serde dance on hydration.';
