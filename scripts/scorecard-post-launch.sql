-- POST-LAUNCH T+24h HEALTH SCORECARD — read-only.
--
-- The ADR-0007 "scorecard" is the OUTREACH scorecard (cut from scope per the
-- 2026-05-29 pivot), so the meaningful T+24h sanity check is technical health.
-- This is the post-launch analogue of scripts/calibration-v1-queries.sql.
--
-- Usage (read-only; safe on prod):
--   ssh ${PEGANA_DEPLOY_SERVER} \
--     "docker exec -i pegana-postgres-1 psql -U pegana -d pegana" \
--     < scripts/scorecard-post-launch.sql
--
-- Window: public launch (FEATURE_PUBLIC_ALERTS flip) → now. Adjust :win_lo to
-- the exact flip timestamp if you want it precise.

\set win_lo '2026-06-11 00:00:00+00'

\echo '=== A. PER-ASSET DISCOUNT DISTRIBUTION (since launch) ==='
\echo '(discount_snapshots.discount_smooth — the engine canonical smoothed series)'
SELECT
    asset,
    COUNT(*) AS samples,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY ABS(discount_smooth * 10000))::int AS p50_bps,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY ABS(discount_smooth * 10000))::int AS p95_bps,
    percentile_cont(0.99) WITHIN GROUP (ORDER BY ABS(discount_smooth * 10000))::int AS p99_bps,
    MAX(ABS(discount_smooth * 10000))::int AS max_bps
FROM discount_snapshots
WHERE ts >= :'win_lo'
GROUP BY asset
ORDER BY p99_bps DESC;

\echo ''
\echo '=== B. ALERTS FIRED SINCE LAUNCH — split by monitoring_only ==='
\echo '(monitoring_only rows are recorded internally but SUPPRESSED from every'
\echo ' public surface by the 2026-06-12 egress gate. Both shown so you can see'
\echo ' what was suppressed vs surfaced. A monitoring_only CRITICAL here = the'
\echo ' egress gate doing its job; a NON-monitoring false alert = investigate.)'
SELECT
    a.asset,
    COALESCE((m.metadata->>'monitoring_only')::boolean, false) AS monitoring_only,
    a.from_state, a.to_state,
    COUNT(*) AS n,
    MIN(a.detected_at) AS first_seen,
    MAX(a.detected_at) AS last_seen
FROM alerts a
LEFT JOIN assets m ON m.symbol = a.asset
WHERE a.detected_at >= :'win_lo'
GROUP BY a.asset, monitoring_only, a.from_state, a.to_state
ORDER BY monitoring_only DESC, n DESC;

\echo ''
\echo '=== C. PUBLIC LEDGER SANITY — alerts in last 24h that DO surface publicly ==='
\echo '(applies the egress-gate predicate; this is what /v1/alerts + /v1/stats now show)'
SELECT
    COUNT(*) FILTER (WHERE NOT mon) AS public_alerts_24h,
    COUNT(*) FILTER (WHERE mon)     AS suppressed_monitoring_24h
FROM (
    SELECT COALESCE((SELECT (m.metadata->>'monitoring_only')::boolean
                     FROM assets m WHERE m.symbol = a.asset), false) AS mon
    FROM alerts a
    WHERE a.detected_at >= now() - interval '24 hours'
) t;

\echo ''
\echo '=== D. JupUSD focus — is the false-CRITICAL truly resolved? ==='
SELECT from_state, to_state, COUNT(*) AS n,
       MIN(detected_at) AS first_seen, MAX(detected_at) AS last_seen
FROM alerts
WHERE asset = 'JupUSD' AND detected_at >= :'win_lo'
GROUP BY from_state, to_state ORDER BY n DESC;

\echo ''
\echo '=== E. SILENT-BUT-SAMPLING check (no alerts but data flowing = calm, not dead) ==='
WITH firing AS (
    SELECT DISTINCT asset FROM alerts WHERE detected_at >= :'win_lo'
),
sampling AS (
    SELECT asset, COUNT(*) AS snaps FROM discount_snapshots
    WHERE ts >= :'win_lo' GROUP BY asset
)
SELECT a.symbol AS asset,
       COALESCE(s.snaps, 0) AS snapshots,
       CASE WHEN COALESCE(s.snaps,0) = 0 THEN 'OUTAGE — no snapshots'
            WHEN COALESCE(s.snaps,0) < 50 THEN 'THIN — sparse'
            ELSE 'CALM — sampling fine, simply did not transition' END AS verdict
FROM assets a
LEFT JOIN firing f ON f.asset = a.symbol
LEFT JOIN sampling s ON s.asset = a.symbol
WHERE a.is_active AND f.asset IS NULL
ORDER BY snapshots ASC;

\echo ''
\echo '=== Done. ==='
