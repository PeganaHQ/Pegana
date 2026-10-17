-- CALIBRATION MONITOR — read-only. Two jobs in one query file:
--
--   A. PROMOTION READINESS — the 06-18 retro tool. For each of the 11
--      monitoring_only assets, evaluates the promotion gate from
--      docs/operations/monitoring-only-promotion-criteria.md: >=7 days of data,
--      p95 effective discount inside the asset's own `drift` band, and zero
--      CRITICAL in the window. sHYUSD is HARD-BLOCK and xSOL is PERMANENT
--      (Class C) per ADR.
--
--   B. CALIBRATION SELF-MONITOR — the ongoing "is each asset still calibrated?"
--      check (net-new #3). Flags any active asset whose live p95 effective
--      discount has drifted into (WATCH) or beyond (MISCALIBRATED) its own
--      band — a trust oracle that knows when it's miscalibrated.
--
-- Read-only; safe on prod. Run:
--   ssh ${PEGANA_DEPLOY_SERVER} \
--     "docker exec -i pegana-postgres-1 psql -U pegana -d pegana" \
--     < scripts/calibration-monitor.sql
--
-- Window = trailing 8 days; promotion needs >=7 distinct days covered. Run it on
-- or after 2026-06-18 for the Phase-0 cohort to clear the 7-day data gate.
--
-- FX-CLASS CAVEAT (EURC, BRZ, any class='stable_fx'): their intrinsic is a Pyth
-- FX feed that goes dark from the Friday forex close to the Sunday reopen
-- (~21:00–22:00 UTC each side, DST-dependent: summer ~21:00, winter ~22:00).
-- Verified live 2026-06-14 (summer): only ONE UTC date per weekend (Saturday)
-- loses all rows — Friday keeps its pre-close rows and Sunday its post-reopen
-- rows — so days_covered drops by ~1/weekend, NOT 2, and the 7-of-8 gate is usually still
-- reachable (a window straddling two Saturdays loses 2). When an FX asset DOES
-- fall short, Section A flags it ('FX-WEEKEND-AWARE') so the operator subtracts
-- weekend Saturdays before treating <7 days as a real coverage gap (not downtime).

\set lookback_days 8
\set min_days 7

\echo '=== A. PROMOTION READINESS (monitoring_only assets) ==='
\echo '(p95/p99 = direction-sensitive effective discount (bps) over the trailing 8d; gate per promotion-criteria.md)'
WITH w AS (
    SELECT now() - (:'lookback_days' || ' days')::interval AS lo
),
dist AS (
    SELECT ds.asset,
           count(*)                                                              AS samples,
           count(DISTINCT (ds.ts AT TIME ZONE 'UTC')::date)                      AS days_covered,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY (
               CASE
                   -- direction-sensitive classes (methodology is_direction_sensitive = {lst, stable_yield}):
                   -- discount side counts; benign premium carved out (ADR-0021); premium beyond
                   -- NAV_PREMIUM_SANITY_BPS (=1000, methodology 0.4.0) counts at full magnitude
                   -- (mirrors premium_sanity_violated -> UNKNOWN). Keep in sync with effective_bps() below.
                   WHEN m.class::text IN ('lst','stable_yield') THEN
                       CASE
                           WHEN ds.discount_smooth >= 0 THEN ds.discount_smooth * 10000
                           WHEN abs(ds.discount_smooth) * 10000 > 1000 THEN abs(ds.discount_smooth) * 10000
                           ELSE 0
                       END
                   ELSE abs(ds.discount_smooth * 10000)
               END
           ))::int AS p95_bps,
           percentile_cont(0.99) WITHIN GROUP (ORDER BY (
               CASE
                   WHEN m.class::text IN ('lst','stable_yield') THEN
                       CASE
                           WHEN ds.discount_smooth >= 0 THEN ds.discount_smooth * 10000
                           WHEN abs(ds.discount_smooth) * 10000 > 1000 THEN abs(ds.discount_smooth) * 10000
                           ELSE 0
                       END
                   ELSE abs(ds.discount_smooth * 10000)
               END
           ))::int AS p99_bps,
           max(ds.ts)                                                            AS last_ts
    FROM discount_snapshots ds
    JOIN assets m ON m.symbol = ds.asset
    CROSS JOIN w
    WHERE ds.ts >= w.lo
    GROUP BY ds.asset
),
crit AS (
    SELECT a.asset, count(*) AS criticals
    FROM alerts a, w
    WHERE a.detected_at >= w.lo AND a.to_state::text IN ('CRITICAL', 'BLACK_SWAN')
    GROUP BY a.asset
)
SELECT
    m.symbol,
    (m.thresholds->>'drift_bps')::int                          AS drift_bps,
    COALESCE(d.days_covered, 0)                                AS days,
    d.p95_bps,
    d.p99_bps,
    COALESCE(c.criticals, 0)                                   AS criticals,
    CASE
        WHEN m.symbol = 'sHYUSD' THEN 'HARD-BLOCK — fix market/intrinsic leg first'
        WHEN m.symbol = 'xSOL'   THEN 'PERMANENT — Class C, monitoring-only by design'
        WHEN m.class = 'stable_fx' AND (d.days_covered IS NULL OR d.days_covered < :min_days)
            THEN 'FX-WEEKEND-AWARE — ' || COALESCE(d.days_covered, 0)
                 || 'd; FX feed goes dark each Saturday (forex closed), so ~1 day/weekend is expected-missing. Subtract weekend Saturdays before judging this a real gap.'
        WHEN d.days_covered IS NULL OR d.days_covered < :min_days
            THEN 'NOT-YET — <7d data (' || COALESCE(d.days_covered, 0) || 'd)'
        WHEN (m.thresholds->>'drift_bps') IS NULL
            THEN 'MANUAL — non-bps thresholds (CDP), evaluate by hand'
        WHEN COALESCE(c.criticals, 0) > 0
            THEN 'NOT-YET — ' || c.criticals || ' CRITICAL in window'
        WHEN d.p95_bps < (m.thresholds->>'drift_bps')::int
            THEN 'PROMOTION-READY'
        ELSE 'NOT-YET — p95 ' || d.p95_bps || ' >= drift '
             || (m.thresholds->>'drift_bps') || ' (for lst/stable_yield calibrate the DISCOUNT side; never widen the band to fit a premium — ADR-0029)'
    END                                                        AS verdict
FROM assets m
LEFT JOIN dist d ON d.asset = m.symbol
LEFT JOIN crit c ON c.asset = m.symbol
WHERE COALESCE((m.metadata->>'monitoring_only')::boolean, false)
ORDER BY verdict, m.symbol;

\echo ''
\echo '=== B. CALIBRATION SELF-MONITOR (all active assets) ==='
\echo '(🔴 MISCALIBRATED = p95 above its own depeg line; 🟡 WATCH = inside drift band; 🟢 OK)'
WITH w AS (
    SELECT now() - (:'lookback_days' || ' days')::interval AS lo
),
dist AS (
    SELECT ds.asset,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY (
               CASE
                   -- direction-sensitive classes (methodology is_direction_sensitive = {lst, stable_yield}):
                   -- discount side counts; benign premium carved out (ADR-0021); premium beyond
                   -- NAV_PREMIUM_SANITY_BPS (=1000, methodology 0.4.0) counts at full magnitude
                   -- (mirrors premium_sanity_violated -> UNKNOWN). Keep in sync with effective_bps() below.
                   WHEN m.class::text IN ('lst','stable_yield') THEN
                       CASE
                           WHEN ds.discount_smooth >= 0 THEN ds.discount_smooth * 10000
                           WHEN abs(ds.discount_smooth) * 10000 > 1000 THEN abs(ds.discount_smooth) * 10000
                           ELSE 0
                       END
                   ELSE abs(ds.discount_smooth * 10000)
               END
           ))::int AS p95_bps,
           percentile_cont(0.99) WITHIN GROUP (ORDER BY (
               CASE
                   WHEN m.class::text IN ('lst','stable_yield') THEN
                       CASE
                           WHEN ds.discount_smooth >= 0 THEN ds.discount_smooth * 10000
                           WHEN abs(ds.discount_smooth) * 10000 > 1000 THEN abs(ds.discount_smooth) * 10000
                           ELSE 0
                       END
                   ELSE abs(ds.discount_smooth * 10000)
               END
           ))::int AS p99_bps
    FROM discount_snapshots ds
    JOIN assets m ON m.symbol = ds.asset
    CROSS JOIN w
    WHERE ds.ts >= w.lo
    GROUP BY ds.asset
)
SELECT
    a.symbol,
    COALESCE((a.metadata->>'monitoring_only')::boolean, false) AS mon_only,
    (a.thresholds->>'drift_bps')::int                          AS drift_bps,
    (a.thresholds->>'depeg_bps')::int                          AS depeg_bps,
    d.p95_bps,
    d.p99_bps,
    CASE
        WHEN (a.thresholds->>'drift_bps') IS NULL THEN 'n/a — non-bps thresholds'
        WHEN d.p95_bps IS NULL                    THEN 'no data in window'
        WHEN d.p95_bps > (a.thresholds->>'depeg_bps')::int  THEN '🔴 MISCALIBRATED — p95 above depeg'
        WHEN d.p95_bps > (a.thresholds->>'drift_bps')::int  THEN '🟡 WATCH — p95 in drift band'
        ELSE '🟢 OK'
    END                                                        AS calibration_health
FROM assets a
LEFT JOIN dist d ON d.asset = a.symbol
WHERE a.is_active
ORDER BY d.p95_bps DESC NULLS LAST;
