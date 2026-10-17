-- BETA → CALIBRATED PROMOTION RETRO — read-only. The 2026-07-23 retro tool.
--
-- Adapted from scripts/calibration-monitor.sql Section A (the blessed 06-18 retro
-- query) for the beta→calibrated batch-2 promotion (docs/operations/
-- 2026-07-23-beta-promotion-retro-report.md). Emits, per monitoring_only (beta)
-- asset, a MECHANICAL PROMOTE / HOLD verdict against the ADR-0015 gate
-- (docs/operations/monitoring-only-promotion-criteria.md + ADR-0029):
--
--   1. Data completeness — >=7 distinct days in the trailing 8d window AND no
--      snapshot gap > 6h (a source_outage stops discount_snapshots being written
--      — the engine only writes a discount when BOTH the intrinsic and market
--      legs are present — so a gap in this series IS a source outage). Section A
--      column `max_gap_h`.
--   2. Calibration — p95 |effective discount| < the asset's own drift_bps,
--      direction-sensitive per ADR-0029 (discount side counts; benign premium
--      carved out; premium beyond NAV_PREMIUM_SANITY_BPS=1000 counts full). This
--      is exactly the `/v1/calibration` `health: ok` flag. Column `p95_bps`.
--   3. Zero noise — 0 transitions labelled false_positive/noisy. There is NO
--      label table in the DB (verified 2026-07-23 — grep of migrations/), so this
--      is a MANUAL step: Section A emits `transitions` (count) + `criticals`, and
--      Section B lists every transition in the window for the operator to
--      classify. A calm, well-calibrated beta asset shows 0 transitions.
--   4. Can the engine detect a real move? (the frozen-signal / liquidity gate,
--      NOT a DB-only check) — Section A emits `liq_usd` from liquidity_observations
--      (tokens.xyz coverage) where available; where NULL, the operator fills it
--      with the Birdeye token_overview check (floor = DEXSCREENER_MIN_LIQUIDITY_USD,
--      ADR-0026). A single-source / dust market leg reads PEGGED even during a real
--      depeg, so promoting it would be dishonest (ADR-0024). The per-asset market
--      SOURCE (jupiter_usd vs a single dex_screener pool) is CONFIG, not DB — see
--      the frozen-signal table in the retro report; hyloSOL+ / ONyc are the flagged
--      candidates (ONyc's leg was switched to Jupiter 2026-07-01 "deep on Jupiter",
--      assets.toml — the report resolves it against liq_usd here + Birdeye).
--
-- Read-only; safe on prod. Run:
--   ssh ${PEGANA_DEPLOY_SERVER} \
--     "docker exec -i pegana-postgres-1 psql -U pegana -d pegana" \
--     < scripts/beta-promotion-retro.sql > /tmp/beta-retro.txt
--
-- Window = trailing 8 days; promotion needs >=7 distinct days covered. The
-- mig-0053-era betas are >=26 days old (D3 of the plan), so the 7-of-8 gate is
-- satisfiable now. (The mig-0064 LSTs are NOT in prod yet — a future retro.)

\set lookback_days 8
\set min_days 7
\set max_gap_hours 6
\set min_liq_usd 25000

\echo '=== A. PROMOTION READINESS (monitoring_only / beta assets) ==='
\echo '(p95/p99 = direction-sensitive effective discount (bps), trailing 8d; gate per promotion-criteria.md + ADR-0029)'
\echo '(max_gap_h > 6 => a source outage broke completeness even if days>=7; liq_usd NULL => needs the Birdeye check)'
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
                   -- NAV_PREMIUM_SANITY_BPS (=1000, methodology 0.4.0) counts at full magnitude.
                   -- Keep in sync with calibration-monitor.sql / effective_bps().
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
-- Largest gap between consecutive discount recomputes in the window. A
-- source_outage (Jupiter/intrinsic down) stops the engine writing discounts, so a
-- large gap == an outage even when >=7 distinct days were still touched.
gaps AS (
    SELECT ds.asset,
           ds.ts - lag(ds.ts) OVER (PARTITION BY ds.asset ORDER BY ds.ts) AS gap
    FROM discount_snapshots ds
    CROSS JOIN w
    WHERE ds.ts >= w.lo
),
gapmax AS (
    SELECT asset, max(gap) AS max_gap FROM gaps GROUP BY asset
),
-- ALL state transitions in the window (for manual noise classification) + the
-- CRITICAL/BLACK_SWAN subset (a hard NOT-YET).
trans AS (
    SELECT a.asset,
           count(*)                                                        AS transitions,
           count(*) FILTER (WHERE a.to_state::text IN ('CRITICAL','BLACK_SWAN')) AS criticals
    FROM alerts a, w
    WHERE a.detected_at >= w.lo
    GROUP BY a.asset
),
-- Latest DB liquidity observation (tokens.xyz coverage). NULL => not covered =>
-- the operator fills it with the Birdeye token_overview check.
liq AS (
    SELECT DISTINCT ON (asset) asset, liquidity_usd, ts
    FROM liquidity_observations
    ORDER BY asset, ts DESC
)
SELECT
    m.symbol,
    m.class,
    (m.thresholds->>'drift_bps')::int                          AS drift_bps,
    COALESCE(d.days_covered, 0)                                AS days,
    round((EXTRACT(EPOCH FROM g.max_gap) / 3600.0)::numeric, 1) AS max_gap_h,
    d.p95_bps,
    d.p99_bps,
    COALESCE(t.transitions, 0)                                 AS transitions,
    COALESCE(t.criticals, 0)                                   AS criticals,
    round(l.liquidity_usd, 0)                                  AS liq_usd,
    CASE
        WHEN m.symbol = 'sHYUSD' THEN 'HARD-BLOCK — fix market/intrinsic leg first (ADR / criteria step 5)'
        WHEN m.symbol = 'xSOL'   THEN 'PERMANENT — Class C, monitoring-only by design'
        WHEN d.days_covered IS NULL OR d.days_covered < :min_days
            THEN 'HOLD — <7d data (' || COALESCE(d.days_covered, 0) || 'd)'
        WHEN g.max_gap IS NOT NULL AND EXTRACT(EPOCH FROM g.max_gap) / 3600.0 > :max_gap_hours
            THEN 'HOLD — source outage: ' || round((EXTRACT(EPOCH FROM g.max_gap)/3600.0)::numeric, 1) || 'h gap (>6h)'
        WHEN (m.thresholds->>'drift_bps') IS NULL
            THEN 'MANUAL — non-bps thresholds, evaluate by hand'
        WHEN COALESCE(t.criticals, 0) > 0
            THEN 'HOLD — ' || t.criticals || ' CRITICAL/BLACK_SWAN in window'
        WHEN d.p95_bps >= (m.thresholds->>'drift_bps')::int
            THEN 'HOLD — p95 ' || d.p95_bps || ' >= drift ' || (m.thresholds->>'drift_bps')
                 || ' (lst/stable_yield: calibrate the DISCOUNT side; never widen to fit a premium — ADR-0029)'
        WHEN l.liquidity_usd IS NOT NULL AND l.liquidity_usd < :min_liq_usd
            THEN 'HOLD — thin liquidity $' || round(l.liquidity_usd,0) || ' < $' || :min_liq_usd || ' floor'
        WHEN l.liquidity_usd IS NULL
            THEN 'CHECK-LIQ — passes DB gate; run Birdeye token_overview (no tokens.xyz obs)'
        WHEN COALESCE(t.transitions, 0) > 0
            THEN 'REVIEW — passes DB gate + liq, but ' || t.transitions || ' transition(s): classify noise (Section B)'
        ELSE 'PROMOTE-READY — passes all DB gates; confirm market leg is non-single-source (report)'
    END                                                        AS verdict
FROM assets m
LEFT JOIN dist   d ON d.asset = m.symbol
LEFT JOIN gapmax g ON g.asset = m.symbol
LEFT JOIN trans  t ON t.asset = m.symbol
LEFT JOIN liq    l ON l.asset = m.symbol
WHERE COALESCE((m.metadata->>'monitoring_only')::boolean, false)
ORDER BY verdict, m.class, m.symbol;

\echo ''
\echo '=== B. TRANSITION DETAIL (manual noise classification — criteria step 3) ==='
\echo '(Every state change in the window for beta assets. Classify each: real move vs false_positive/noisy.'
\echo ' Any beta asset with a false_positive/noisy transition HOLDS regardless of Section A verdict.)'
WITH w AS (
    SELECT now() - (:'lookback_days' || ' days')::interval AS lo
)
SELECT
    a.detected_at,
    a.asset,
    m.class,
    a.from_state,
    a.to_state,
    (a.discount * 10000)::int AS discount_bps
FROM alerts a
JOIN assets m ON m.symbol = a.asset
CROSS JOIN w
WHERE a.detected_at >= w.lo
  AND COALESCE((m.metadata->>'monitoring_only')::boolean, false)
ORDER BY a.asset, a.detected_at;

\echo ''
\echo '=== Done. Feed Section A verdicts + Section B noise classification into'
\echo '=== docs/operations/2026-07-23-beta-promotion-retro-report.md, then finalize mig 0069. ==='
