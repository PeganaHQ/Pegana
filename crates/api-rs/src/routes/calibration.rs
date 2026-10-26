//! /v1/calibration — per-asset calibration self-monitor (read-only).
//!
//! The live counterpart of `scripts/calibration-monitor.sql` § B: for each
//! active asset it compares the trailing-8d p95 of the direction-sensitive
//! effective discount against the asset's own band and classifies calibration
//! health. Benign lst/stable_yield premiums are carved out; premiums beyond the
//! 10% NAV-sanity bound count as broken anchors. Pure read; no engine/signal
//! change.

use crate::error::ApiError;
use crate::AppState;
use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::sync::Arc;
use utoipa::ToSchema;

/// Read-through cache for `/v1/calibration`.
///
/// WHY THIS EXISTS: `compute_calibration_health` computes p95/p99 over 8 days
/// of the raw `discount_snapshots` hypertable (originally two
/// `percentile_cont` ordered-set aggregates; now an exact histogram, see the
/// query, which is about 3x cheaper but still a full 8-day scan). Its PK is `(asset, ts)`, so a `ts`-only predicate gets no index
/// seek, and an ordered-set aggregate must materialise and sort every value per
/// group; it cannot stream. Measured at ~4.5s in prod, and it is NOT
/// indexable away.
///
/// That made the endpoint an unauthenticated denial-of-wallet: at the 300/min
/// per-IP limit, one IP demands 300 x 4.5s = 1350 connection-seconds per minute
/// against a 25-connection pool's 1500; ~90% of the API's entire DB capacity,
/// stalling every other route. The `Cache-Control: max-age=30` header did
/// nothing: Caddy is a bare `reverse_proxy` with no response cache, so every
/// request reached Postgres.
///
/// The fix costs nothing to compute: the 60s metrics task in `main.rs` ALREADY
/// calls `compute_calibration_health` for the Prometheus gauges and drops the
/// result. Now it writes it here on the way past, and the handler reads it.
/// A side benefit: `/status` and the `PeganaAssetMiscalibrated` alert now read
/// the same snapshot instead of two independently-computed ones.
pub(crate) const CALIBRATION_CACHE_KEY: &str = "v1:calibration:summary";

/// Longer than the 60s writer interval so a normal tick never races expiry.
/// If the writer dies the key lapses and requests fall back to a live compute;
/// slow, but correct, and the dead task is itself alarmed. Never serve stale
/// forever to dodge load.
pub(crate) const CALIBRATION_CACHE_TTL_SECS: u64 = 90;

/// Cadence of the writer task in `main.rs` that populates the cache above.
pub(crate) const CALIBRATION_CACHE_WRITER_INTERVAL_SECS: u64 = 60;

// Compile-time guard: if the TTL ever drops to or below the writer's tick, the
// key expires between writes and every ~60th request eats the full ~4.5s scan —
// the denial-of-wallet returns on a sawtooth instead of a flat line. A build
// failure is the right place to catch that, not a test someone can delete.
const _: () = assert!(
    CALIBRATION_CACHE_TTL_SECS > CALIBRATION_CACHE_WRITER_INTERVAL_SECS,
    "calibration cache TTL must outlive the writer interval"
);

/// Cached payload. Carries the COMPUTE time so the response envelope can be
/// honest about staleness rather than restamping `now` on every cache hit.
#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct CachedCalibration {
    pub generated_at: String,
    pub data: Vec<CalibrationHealth>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CalibrationHealth {
    pub symbol: String,
    /// Calibration-status flag (not a health state). `monitoring_only` (beta)
    /// assets now alert publicly, but their calibration is provisional; the
    /// flag lets clients label them as beta.
    pub monitoring_only: bool,
    /// Self-describing form of `monitoring_only`, `provisional` | `calibrated`;
    /// same vocabulary as the webhook canonical event and the other read
    /// surfaces. Always present.
    #[schema(value_type = crate::schema::Calibration)]
    pub calibration: String,
    /// Asset's own drift / depeg bands (bps), from `assets.thresholds`. `None`
    /// for the CDP collateral-ratio thresholds shape (hyUSD), where the bps
    /// comparison does not apply.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drift_bps: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depeg_bps: Option<i32>,
    /// Trailing-8d p95 of the direction-sensitive effective discount (bps):
    /// discount side counts; benign lst/stable_yield premiums are carved out;
    /// premiums beyond the 10% NAV-sanity bound count as broken anchors. `None`
    /// when the source is dark (no snapshot, or <200 samples in the 8d window).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p95_bps: Option<i32>,
    /// Trailing-8d p99 of the direction-sensitive effective discount (bps):
    /// discount side counts; benign lst/stable_yield premiums are carved out;
    /// premiums beyond the 10% NAV-sanity bound count as broken anchors. `None`
    /// when the source is dark (no snapshot, or <200 samples in the 8d window).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p99_bps: Option<i32>,
    /// `ok` | `watch` (p95 in the drift band) | `miscalibrated` (p95 beyond the
    /// depeg band) | `no_data` | `na` (non-bps thresholds).
    pub health: String,
}

/// Effective discount magnitude (bps) used by the calibration p95/p99.
/// Mirrors the CASE in the `dist` CTE (and calibration-monitor.sql §B).
/// Direction-sensitive classes (lst, stable_yield): discount side counts;
/// a benign premium (≤ NAV_PREMIUM_SANITY_BPS) is carved out; a premium beyond
/// it counts at full magnitude. Symmetric classes: abs().
#[cfg(test)]
fn effective_bps(class: &str, discount_bps: f64) -> f64 {
    const NAV_PREMIUM_SANITY_BPS: f64 = 1000.0; // methodology 0.4.0
    if class == "lst" || class == "stable_yield" {
        if discount_bps >= 0.0 {
            discount_bps
        } else if discount_bps.abs() > NAV_PREMIUM_SANITY_BPS {
            discount_bps.abs()
        } else {
            0.0
        }
    } else {
        discount_bps.abs()
    }
}

/// Classify calibration health from the trailing p95 vs the asset's bands.
/// Mirrors the CASE in `scripts/calibration-monitor.sql` § B.
fn classify(p95: Option<i32>, drift: Option<i32>, depeg: Option<i32>) -> &'static str {
    let Some(drift) = drift else {
        return "na";
    };
    let Some(p95) = p95 else {
        return "no_data";
    };
    if let Some(depeg) = depeg {
        if p95 > depeg {
            return "miscalibrated";
        }
    }
    if p95 > drift {
        return "watch";
    }
    "ok"
}

/// Trailing-8d p95/p99 of the direction-sensitive effective discount per
/// asset, joined to the asset's own bands, classified into a `health`
/// state. Shared by the `/v1/calibration` handler (below) and the periodic
/// `pegana_calibration_*` gauge task in `main.rs`; one SQL query, two
/// consumers, so the metrics never drift from what the endpoint reports.
pub(crate) async fn compute_calibration_health(
    pg: &PgPool,
) -> Result<Vec<CalibrationHealth>, sqlx::Error> {
    // Reads the raw hot table (same source as the ops SQL).
    let rows = sqlx::query(
        r#"
        -- p95/p99 via an exact histogram instead of two percentile_cont sorts.
        -- discount_smooth is NUMERIC(10,6), so the effective bps value takes a
        -- few thousand distinct values per asset: GROUP BY (asset, value) is
        -- one streaming hash aggregate over the 8d window, and percentile_cont
        -- is then rebuilt exactly from the cumulative counts (rank
        -- r = p*(N-1), interpolate between the values at floor(r) and ceil(r),
        -- in float8 like percentile_cont). Same results as the old two-sort
        -- query on a 4.6M-row test set, about 3x faster (3.3s -> 1.1s); the old
        -- form tripped the 1s slow-statement warning on every 60s tick.
        WITH hist AS (
            SELECT ds.asset,
                   (CASE
                       -- direction-sensitive classes (methodology is_direction_sensitive = {lst, stable_yield}):
                       -- discount side counts; benign premium carved out (ADR-0021); premium beyond
                       -- NAV_PREMIUM_SANITY_BPS (=1000, methodology 0.4.0) counts at full magnitude
                       -- (mirrors premium_sanity_violated -> UNKNOWN). Keep in sync with effective_bps() below.
                       WHEN a.class::text IN ('lst','stable_yield') THEN
                           CASE
                               WHEN ds.discount_smooth >= 0 THEN ds.discount_smooth * 10000
                               WHEN abs(ds.discount_smooth) * 10000 > 1000 THEN abs(ds.discount_smooth) * 10000
                               ELSE 0
                           END
                       ELSE abs(ds.discount_smooth * 10000)
                   END)::float8 AS v,
                   count(*) AS n
            FROM discount_snapshots ds
            JOIN assets a ON a.symbol = ds.asset
            WHERE ds.ts >= now() - INTERVAL '8 days'
            GROUP BY 1, 2
        ), cum AS (
            -- c = samples with value <= v (cumulative through v).
            SELECT asset, v,
                   sum(n) OVER (PARTITION BY asset ORDER BY v) AS c,
                   sum(n) OVER (PARTITION BY asset) AS total
            FROM hist
        ), pos AS (
            SELECT asset, v, c, total,
                   0.95::float8 * (total - 1) AS r95,
                   0.99::float8 * (total - 1) AS r99
            FROM cum
        ), dist AS (
            -- value at 0-based rank k = min(v) over rows with c > k.
            SELECT asset,
                   max(total)::bigint AS samples,
                   (min(v) FILTER (WHERE c > floor(r95))
                     + (r95 - floor(r95))
                     * (min(v) FILTER (WHERE c > ceil(r95)) - min(v) FILTER (WHERE c > floor(r95)))
                   )::int AS p95,
                   (min(v) FILTER (WHERE c > floor(r99))
                     + (r99 - floor(r99))
                     * (min(v) FILTER (WHERE c > ceil(r99)) - min(v) FILTER (WHERE c > floor(r99)))
                   )::int AS p99
            FROM pos
            GROUP BY asset, r95, r99
        )
        SELECT a.symbol,
               COALESCE((a.metadata->>'monitoring_only')::boolean, false) AS monitoring_only,
               (a.thresholds->>'drift_bps')::int AS drift_bps,
               (a.thresholds->>'depeg_bps')::int AS depeg_bps,
               -- Silent / near-empty source guard: a healthy active asset writes a
               -- discount_snapshot every recompute (~thousands in 8d). Fewer than 200
               -- means the market/intrinsic leg is effectively dark (e.g. USDu) — its
               -- p95 is meaningless, so surface no_data, never a confident `ok`.
               CASE WHEN COALESCE(d.samples, 0) < 200 THEN NULL ELSE d.p95 END AS p95_bps,
               CASE WHEN COALESCE(d.samples, 0) < 200 THEN NULL ELSE d.p99 END AS p99_bps
        FROM assets a
        LEFT JOIN dist d ON d.asset = a.symbol
        WHERE a.is_active
          -- Exclude leveraged synths (synth_lev, e.g. xSOL) — same serve-layer
          -- removal already applied to /v1/assets, /v1/peg/feed and /v1/stats
          -- (2026-07-23). A leveraged junior tranche has no peg, so its bands
          -- are meaningless here: xSOL was the single `miscalibrated` row
          -- (p95 ~9900 bps vs a 1500 bps drift band), which made this endpoint
          -- both disagree with every other count (69 vs 68) and advertise a
          -- calibration failure for an asset deliberately off the peg surface.
          AND a.class::text <> 'synth_lev'
        ORDER BY p95_bps DESC NULLS LAST, a.symbol
        "#,
    )
    .fetch_all(pg)
    .await?;

    let out: Vec<CalibrationHealth> = rows
        .into_iter()
        .map(|r| {
            let drift_bps: Option<i32> = r.try_get("drift_bps").ok();
            let depeg_bps: Option<i32> = r.try_get("depeg_bps").ok();
            let p95_bps: Option<i32> = r.try_get("p95_bps").ok();
            let p99_bps: Option<i32> = r.try_get("p99_bps").ok();
            let monitoring_only = r.try_get("monitoring_only").unwrap_or(false);
            CalibrationHealth {
                symbol: r.get("symbol"),
                monitoring_only,
                calibration: crate::schema::calibration_label(monitoring_only).into(),
                drift_bps,
                depeg_bps,
                p95_bps,
                p99_bps,
                health: classify(p95_bps, drift_bps, depeg_bps).to_string(),
            }
        })
        .collect();

    Ok(out)
}

#[utoipa::path(
    get,
    path = "/v1/calibration",
    tag = "Stats",
    operation_id = "calibration_health",
    summary = "Per-asset calibration self-monitor (p95 vs band, 8d)",
    responses(
        (status = 200, description = "Calibration health per active asset", body = crate::response::ApiList<CalibrationHealth>),
        (status = 429, description = "Rate limit exceeded; see Retry-After header", body = ApiError),
        (status = 500, description = "Unexpected server error", body = ApiError)
    )
)]
pub async fn summary(State(state): State<Arc<AppState>>) -> Result<impl IntoResponse, ApiError> {
    // Advisory only — there is no CDN or caching proxy in front of this. The
    // server-side Redis cache below is what actually protects Postgres.
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=30, stale-while-revalidate=60"),
    );

    let mut redis_conn = state.redis_connection().await.ok();

    if let Some(conn) = redis_conn.as_mut() {
        let hit: Option<String> = redis::cmd("GET")
            .arg(CALIBRATION_CACHE_KEY)
            .query_async(conn)
            .await
            .ok()
            .flatten();
        if let Some(json) = hit {
            // A decode failure just falls through to a fresh compute — the cache
            // is a pure latency optimisation and must never be able to fail the
            // request.
            if let Ok(cached) = serde_json::from_str::<CachedCalibration>(&json) {
                return Ok((
                    headers,
                    Json(crate::response::ApiList::with_generated_at(
                        cached.data,
                        cached.generated_at,
                    )),
                )
                    .into_response());
            }
        }
    }

    // Miss (cold start, expired key, or Redis down): compute and repopulate, so
    // a restart doesn't leave the expensive path exposed until the next tick.
    let generated_at = crate::serde_fmt::rfc3339_millis_z(&chrono::Utc::now());
    let out = compute_calibration_health(&state.pg)
        .await
        .map_err(ApiError::db)?;
    if let Some(conn) = redis_conn.as_mut() {
        write_calibration_cache(conn, &out, &generated_at).await;
    }

    Ok((
        headers,
        Json(crate::response::ApiList::with_generated_at(
            out,
            generated_at,
        )),
    )
        .into_response())
}

/// Serialise + SETEX the calibration payload. Never fails the caller; a Redis
/// hiccup degrades to "the next request recomputes", never to a dropped tick or
/// a 500.
pub(crate) async fn write_calibration_cache<C: redis::aio::ConnectionLike + Send + Unpin>(
    conn: &mut C,
    rows: &[CalibrationHealth],
    generated_at: &str,
) {
    let payload = CachedCalibration {
        generated_at: generated_at.to_string(),
        data: rows
            .iter()
            .map(|r| CalibrationHealth {
                symbol: r.symbol.clone(),
                monitoring_only: r.monitoring_only,
                calibration: r.calibration.clone(),
                drift_bps: r.drift_bps,
                depeg_bps: r.depeg_bps,
                p95_bps: r.p95_bps,
                p99_bps: r.p99_bps,
                health: r.health.clone(),
            })
            .collect(),
    };
    if let Ok(json) = serde_json::to_string(&payload) {
        let _: Result<(), _> = redis::cmd("SETEX")
            .arg(CALIBRATION_CACHE_KEY)
            .arg(CALIBRATION_CACHE_TTL_SECS)
            .arg(&json)
            .query_async::<()>(conn)
            .await;
    }
}

#[cfg(test)]
mod cache_tests {
    use super::*;

    fn row(symbol: &str, health: &str) -> CalibrationHealth {
        CalibrationHealth {
            symbol: symbol.to_string(),
            monitoring_only: false,
            calibration: "calibrated".to_string(),
            drift_bps: Some(30),
            depeg_bps: Some(100),
            p95_bps: Some(21),
            p99_bps: Some(29),
            health: health.to_string(),
        }
    }

    /// The cache is only safe because the payload survives a JSON round-trip
    /// intact; `CalibrationHealth` gained `Deserialize` purely for this. Note
    /// the `Option` fields carry `skip_serializing_if`, so a `None` is absent
    /// rather than null on the wire; this asserts that still decodes.
    #[test]
    fn cached_payload_round_trips_through_json() {
        let mut sparse = row("EURC", "no_data");
        sparse.p95_bps = None;
        sparse.p99_bps = None;
        sparse.drift_bps = None;
        sparse.depeg_bps = None;

        let original = CachedCalibration {
            generated_at: "2026-07-30T23:27:08.663Z".to_string(),
            data: vec![row("USDY", "ok"), sparse],
        };

        let json = serde_json::to_string(&original).expect("serialise");
        let back: CachedCalibration = serde_json::from_str(&json).expect("deserialise");

        assert_eq!(back.generated_at, original.generated_at);
        assert_eq!(back.data.len(), 2);
        assert_eq!(back.data[0].symbol, "USDY");
        assert_eq!(back.data[0].p95_bps, Some(21));
        assert_eq!(back.data[1].symbol, "EURC");
        assert_eq!(back.data[1].p95_bps, None);
        assert_eq!(back.data[1].health, "no_data");
    }

    /// A cache hit must report WHEN THE DATA WAS COMPUTED, not when the response
    /// was built. Restamping `now` would make a ≤90s-old payload claim to be
    /// live; the exact staleness lie `generated_at` exists to prevent, on the
    /// product whose whole pitch is honest freshness.
    #[test]
    fn cached_response_reports_compute_time_not_request_time() {
        let computed_at = "2026-07-30T23:00:00.000Z".to_string();
        let envelope = crate::response::ApiList::with_generated_at(
            vec![row("USDY", "ok")],
            computed_at.clone(),
        );

        assert_eq!(envelope.generated_at, computed_at);
        assert_eq!(envelope.count, 1);
        assert!(envelope.ok);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_bps_matches_direction_sensitive_methodology() {
        assert_eq!(effective_bps("lst", -170.0), 0.0);
        assert_eq!(effective_bps("lst", 50.0), 50.0);
        assert_eq!(effective_bps("lst", -1185.0), 1185.0);
        assert_eq!(effective_bps("stable_yield", -83.0), 0.0);
        assert_eq!(effective_bps("stable_fiat", -30.0), 30.0);
        assert_eq!(effective_bps("stable_fiat", 30.0), 30.0);
    }

    #[test]
    fn classify_uses_effective_bps_values() {
        assert_eq!(classify(Some(0), Some(140), Some(280)), "ok");
        assert_eq!(classify(Some(1185), Some(30), Some(100)), "miscalibrated");
        assert_eq!(classify(Some(38), Some(30), Some(100)), "watch");
    }

    #[test]
    fn classify_covers_every_band() {
        // sHYUSD: p95 far beyond depeg → miscalibrated.
        assert_eq!(classify(Some(3027), Some(30), Some(100)), "miscalibrated");
        // INF: p95 inside the drift band → watch.
        assert_eq!(classify(Some(153), Some(140), Some(280)), "watch");
        // USDC: p95 below drift → ok.
        assert_eq!(classify(Some(3), Some(15), Some(50)), "ok");
        // exactly on the line is not "over" (strict >).
        assert_eq!(classify(Some(15), Some(15), Some(50)), "ok");
        assert_eq!(classify(Some(50), Some(15), Some(50)), "watch");
        // no snapshot in window.
        assert_eq!(classify(None, Some(15), Some(50)), "no_data");
        // CDP / non-bps thresholds (hyUSD).
        assert_eq!(classify(Some(22), None, None), "na");
    }

    /// Additive serde: optional bps fields omit when None; required keys stay.
    #[test]
    fn serializes_with_optional_bps_omitted() {
        let v = serde_json::to_value(CalibrationHealth {
            symbol: "hyUSD".into(),
            monitoring_only: false,
            calibration: crate::schema::calibration_label(false).into(),
            drift_bps: None,
            depeg_bps: None,
            p95_bps: Some(22),
            p99_bps: Some(23),
            health: "na".into(),
        })
        .expect("serialize");
        let obj = v.as_object().unwrap();
        assert!(
            !obj.contains_key("drift_bps"),
            "drift_bps omitted when None"
        );
        for key in [
            "symbol",
            "monitoring_only",
            "calibration",
            "health",
            "p95_bps",
        ] {
            assert!(obj.contains_key(key), "required key `{key}` present");
        }
        assert_eq!(obj.get("health").and_then(|x| x.as_str()), Some("na"));
        assert_eq!(
            obj.get("calibration").and_then(|x| x.as_str()),
            Some("calibrated")
        );
    }
}
