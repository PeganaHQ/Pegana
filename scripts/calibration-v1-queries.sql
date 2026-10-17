-- CALIBRATION v1 — queries pre-baked.
--
-- Run on 2026-06-10 with the 14-day dogfood window closed.
-- Output feeds docs/CALIBRATION-v1.md:
--   - Per-asset p50/p95/p99 of |discount_bps|
--   - Alerts fired in the window
--   - Sample counts
--
-- Usage:
--   ssh ${PEGANA_DEPLOY_SERVER} \
--     "docker exec -i pegana-postgres-1 psql -U pegana -d pegana" \
--     < scripts/calibration-v1-queries.sql > /tmp/cal-v1.txt
--
-- All queries scoped to the window 2026-05-29 03:55:00 UTC → 2026-06-10 23:59:59 UTC
-- (per ADR-0015 evidence start + the documented 06-10 23:59 UTC end).
-- NOTE: Query A reads discount_snapshots.discount_smooth (the engine's canonical
-- smoothed series — the base table has NO column named `discount`).

\echo '=== A. PER-ASSET DISCOUNT DISTRIBUTION ==='
\echo '(Source: discount_snapshots — every recompute the engine writes)'

WITH window_bounds AS (
    SELECT
        '2026-05-29 03:55:00+00'::timestamptz AS lo,
        '2026-06-10 23:59:59+00'::timestamptz AS hi
)
SELECT
    asset,
    COUNT(*) AS samples,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY ABS(discount_smooth * 10000)) AS p50_bps,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY ABS(discount_smooth * 10000)) AS p95_bps,
    percentile_cont(0.99) WITHIN GROUP (ORDER BY ABS(discount_smooth * 10000)) AS p99_bps,
    MAX(ABS(discount_smooth * 10000)) AS max_bps
FROM discount_snapshots, window_bounds
WHERE ts >= window_bounds.lo AND ts < window_bounds.hi
GROUP BY asset
ORDER BY p99_bps DESC;

\echo ''
\echo '=== B. ALERTS FIRED IN WINDOW ==='
\echo '(Source: alerts — every state transition. detected_at lives on the base table;'
\echo ' the alert_events VIEW renames it to ts, so query the base table here.)'

WITH window_bounds AS (
    SELECT
        '2026-05-29 03:55:00+00'::timestamptz AS lo,
        '2026-06-10 23:59:59+00'::timestamptz AS hi
)
SELECT
    asset,
    from_state,
    to_state,
    COUNT(*) AS n,
    MIN(detected_at) AS first_seen,
    MAX(detected_at) AS last_seen
FROM alerts, window_bounds
WHERE detected_at >= window_bounds.lo AND detected_at < window_bounds.hi
GROUP BY asset, from_state, to_state
ORDER BY asset, COUNT(*) DESC;

\echo ''
\echo '=== C. FULL ALERT LIST (for true/noise classification) ==='

WITH window_bounds AS (
    SELECT
        '2026-05-29 03:55:00+00'::timestamptz AS lo,
        '2026-06-10 23:59:59+00'::timestamptz AS hi
)
SELECT
    id,
    asset,
    from_state,
    to_state,
    (discount * 10000)::int AS discount_bps,
    detected_at
FROM alerts, window_bounds
WHERE detected_at >= window_bounds.lo AND detected_at < window_bounds.hi
ORDER BY detected_at ASC;

\echo ''
\echo '=== D. ASSETS WITH ZERO ALERTS (silent during window) ==='
\echo '(Cross-check that they actually wrote snapshots — silent + no snapshots = source outage, not calm)'

WITH window_bounds AS (
    SELECT
        '2026-05-29 03:55:00+00'::timestamptz AS lo,
        '2026-06-10 23:59:59+00'::timestamptz AS hi
),
active AS (
    SELECT symbol FROM assets WHERE is_active = TRUE
),
firing AS (
    SELECT DISTINCT asset FROM alerts, window_bounds
    WHERE detected_at >= window_bounds.lo AND detected_at < window_bounds.hi
),
sampling AS (
    SELECT asset, COUNT(*) AS snap_count
    FROM discount_snapshots, window_bounds
    WHERE ts >= window_bounds.lo AND ts < window_bounds.hi
    GROUP BY asset
)
SELECT
    a.symbol AS asset,
    COALESCE(s.snap_count, 0) AS snapshots,
    CASE
        WHEN COALESCE(s.snap_count, 0) = 0 THEN 'OUTAGE — no snapshots'
        WHEN COALESCE(s.snap_count, 0) < 100 THEN 'THIN — sparse'
        ELSE 'CALM — sampling fine, simply did not transition'
    END AS verdict
FROM active a
LEFT JOIN firing f ON f.asset = a.symbol
LEFT JOIN sampling s ON s.asset = a.symbol
WHERE f.asset IS NULL
ORDER BY snapshots ASC;

\echo ''
\echo '=== E. CURRENT THRESHOLDS FOR COMPARISON ==='
\echo '(Compare proposed p99 × 1.25 against current drift_bps)'

SELECT
    symbol,
    thresholds->>'drift'    AS drift,
    thresholds->>'depeg'    AS depeg,
    thresholds->>'critical' AS critical
FROM assets
WHERE is_active = TRUE
ORDER BY symbol;

\echo ''
\echo '=== Done. Pipe output into docs/CALIBRATION-v1.md ==='
