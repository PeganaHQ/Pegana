-- 0003: Extend the asset_class enum with the two Hylo-derived classes.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction in
-- PostgreSQL. If you apply migrations via sqlx::migrate! (which wraps each
-- file in a transaction by default), this file must be run separately OR
-- the migration runner must be configured to skip the transaction wrap.
--
-- Idempotent — safe to re-run.
ALTER TYPE asset_class ADD VALUE IF NOT EXISTS 'synth_lev';
ALTER TYPE asset_class ADD VALUE IF NOT EXISTS 'stable_yield';
