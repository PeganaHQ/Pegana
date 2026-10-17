-- 0060: promote 7 beta (monitoring-only) assets to calibrated.
--
-- Clears the monitoring_only flag for the cohort-1 calibration-v1 downgrades
-- (mSOL, INF, bbSOL, hyloSOL — mig 0048), the Phase-0 zero-history stables
-- (JupUSD, EURC — mig 0048), and the expansion-batch AUSD (mig 0053), after the
-- 2026-07-01 recalibration retro: post-ADR-0029 (direction-sensitive health) all
-- 7 read `ok` with 0 transitions in the >=7-day window, satisfying the ADR-0015
-- promotion gate. Per docs/operations/monitoring-only-promotion-criteria.md
-- "Mechanics of promotion" step 3 — mirrors 0048's cleanup clause. Dropping the
-- flag re-enters these assets in the Class A/B calibrated denominator and clears
-- the beta label across every surface. No rebuild (deploy.sh --migrate
-- --config-only). Idempotent (removing an absent jsonb key is a no-op). AUSD's
-- provenance "added" key is preserved; only the three monitoring keys are stripped.

UPDATE assets
SET metadata = metadata - 'monitoring_only' - 'monitoring_since' - 'monitoring_reason'
WHERE symbol IN ('mSOL', 'INF', 'bbSOL', 'hyloSOL', 'JupUSD', 'EURC', 'AUSD');
