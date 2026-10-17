-- Phase-0 7-day calibration retro queries.
--
-- Run on 2026-06-18 after a full 7-day window from launch activation:
--
--   ssh ${PEGANA_DEPLOY_SERVER} 'cd ~/pegana && docker compose exec -T postgres \
--     psql -U "${POSTGRES_USER:-pegana}" -d "${POSTGRES_DB:-pegana}" \
--     -P pager=off -f /dev/stdin' < scripts/phase0-retro-queries.sql
--
-- The window starts at the public launch activation day. Adjust `end_utc`
-- only if the retro is intentionally delayed.

WITH params AS (
    SELECT
        TIMESTAMPTZ '2026-06-11 00:00:00+00' AS start_utc,
        TIMESTAMPTZ '2026-06-18 00:00:00+00' AS end_utc
),
phase0(asset) AS (
    VALUES ('JupUSD'), ('JLP'), ('EURC'), ('dzSOL'), ('vSOL')
),
samples AS (
    SELECT
        d.asset,
        d.ts,
        d.state::text AS state,
        d.discount_raw,
        d.discount_smooth,
        d.intrinsic_usd,
        d.market_usd,
        abs(d.discount_smooth * 10000) AS abs_smooth_bps
    FROM discount_snapshots d
    JOIN phase0 p USING (asset)
    CROSS JOIN params
    WHERE d.ts >= params.start_utc
      AND d.ts < params.end_utc
),
gaps AS (
    SELECT
        asset,
        EXTRACT(EPOCH FROM (ts - lag(ts) OVER (PARTITION BY asset ORDER BY ts))) AS gap_seconds
    FROM samples
),
gap_stats AS (
    SELECT
        asset,
        max(gap_seconds) AS max_sample_gap_seconds
    FROM gaps
    GROUP BY asset
)
SELECT
    s.asset,
    count(*) AS samples,
    min(s.ts) AS first_sample,
    max(s.ts) AS last_sample,
    round(percentile_cont(0.50) WITHIN GROUP (ORDER BY s.abs_smooth_bps)::numeric, 2) AS p50_abs_bps,
    round(percentile_cont(0.95) WITHIN GROUP (ORDER BY s.abs_smooth_bps)::numeric, 2) AS p95_abs_bps,
    round(percentile_cont(0.99) WITHIN GROUP (ORDER BY s.abs_smooth_bps)::numeric, 2) AS p99_abs_bps,
    round(max(s.abs_smooth_bps)::numeric, 2) AS max_abs_bps,
    round(max(g.max_sample_gap_seconds)::numeric, 1) AS max_sample_gap_seconds,
    count(*) FILTER (WHERE s.state = 'PEGGED') AS pegged_samples,
    count(*) FILTER (WHERE s.state = 'DRIFT') AS drift_samples,
    count(*) FILTER (WHERE s.state NOT IN ('PEGGED', 'DRIFT')) AS severe_samples
FROM samples s
LEFT JOIN gap_stats g USING (asset)
GROUP BY s.asset
ORDER BY s.asset;

WITH params AS (
    SELECT
        TIMESTAMPTZ '2026-06-11 00:00:00+00' AS start_utc,
        TIMESTAMPTZ '2026-06-18 00:00:00+00' AS end_utc
),
phase0(asset) AS (
    VALUES ('JupUSD'), ('JLP'), ('EURC'), ('dzSOL'), ('vSOL')
)
SELECT
    p.asset,
    count(a.id) AS alerts,
    min(a.detected_at) AS first_alert,
    max(a.detected_at) AS last_alert,
    string_agg(DISTINCT a.to_state::text, ', ' ORDER BY a.to_state::text) AS states_seen
FROM phase0 p
CROSS JOIN params
LEFT JOIN alerts a
       ON a.asset = p.asset
      AND a.detected_at >= params.start_utc
      AND a.detected_at < params.end_utc
GROUP BY p.asset
ORDER BY p.asset;

WITH params AS (
    SELECT
        TIMESTAMPTZ '2026-06-11 00:00:00+00' AS start_utc,
        TIMESTAMPTZ '2026-06-18 00:00:00+00' AS end_utc
),
phase0(asset) AS (
    VALUES ('JupUSD'), ('JLP'), ('EURC'), ('dzSOL'), ('vSOL')
),
intrinsic AS (
    SELECT
        i.asset,
        count(*) AS intrinsic_samples,
        min(now() - i.ts) AS latest_intrinsic_age
    FROM intrinsic_snapshots i
    JOIN phase0 p USING (asset)
    CROSS JOIN params
    WHERE i.ts >= params.start_utc
      AND i.ts < params.end_utc
    GROUP BY i.asset
),
market AS (
    SELECT
        m.asset,
        count(*) AS market_samples,
        min(now() - m.ts) AS latest_market_age
    FROM market_snapshots m
    JOIN phase0 p USING (asset)
    CROSS JOIN params
    WHERE m.ts >= params.start_utc
      AND m.ts < params.end_utc
    GROUP BY m.asset
)
SELECT
    p.asset,
    coalesce(i.intrinsic_samples, 0) AS intrinsic_samples,
    coalesce(m.market_samples, 0) AS market_samples,
    i.latest_intrinsic_age,
    m.latest_market_age
FROM phase0 p
LEFT JOIN intrinsic i USING (asset)
LEFT JOIN market m USING (asset)
ORDER BY p.asset;
