//! /v1/stats — aggregate counters.

use crate::error::ApiError;
use crate::AppState;
use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue},
    response::IntoResponse,
    Json,
};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use utoipa::ToSchema;

/// Redact chat-id-shaped numbers (6+ consecutive digits) from a string.
/// Telegram errors occasionally embed `chat_id=12345678` or similar; the
/// /v1/stats endpoint is unauthenticated so we redact defensively before
/// returning. Conservative pattern; strings like "2026-05-25" (date) are
/// left intact because the regex requires 6+ contiguous digits.
fn redact_chat_ids(s: &str) -> String {
    // Avoid pulling in the `regex` crate for one pattern; this is the same
    // shape, hand-rolled. Walk the string, copy non-digit chars, and when
    // we hit a run of >=6 digits replace with "[REDACTED_ID]".
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if !c.is_ascii_digit() {
            out.push(c);
            continue;
        }
        let mut run = String::new();
        run.push(c);
        while let Some(&n) = chars.peek() {
            if n.is_ascii_digit() {
                run.push(n);
                chars.next();
            } else {
                break;
            }
        }
        if run.len() >= 6 {
            out.push_str("[REDACTED_ID]");
        } else {
            out.push_str(&run);
        }
    }
    out
}

/// Delivery-pipeline health rollup. Surfaced so the dashboard can show a
/// degraded badge when notifications are silently failing; historically
/// MarkdownV2 escape bugs caused alert_deliveries.status='failed' rows to
/// pile up without any user-visible signal, breaking trust.
#[derive(Debug, Serialize, ToSchema)]
pub struct DeliveryHealth {
    pub sent_24h: i64,
    pub failed_24h: i64,
    /// Most recent failure error message (truncated to 200 chars) if any
    /// failures landed in the last 24h. Useful for ops without forcing the
    /// frontend to query a separate endpoint.
    pub last_failure_error: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct StatsResponse {
    pub assets_tracked: i64,
    /// Count of active assets whose most recent state is `DRIFT`. Derived from
    /// `by_state` so it never disagrees, but surfaced top-level so the home/
    /// trust strip can render a single risk number without parsing the map.
    pub assets_in_drift: i64,
    pub alerts_24h: i64,
    /// Per-state asset counts keyed by the engine's state enum
    /// (`PEGGED` / `DRIFT` / `DEPEG` / `CRITICAL` / `BLACK_SWAN` / `UNKNOWN`).
    /// Empty buckets are omitted, not zero-filled.
    pub by_state: HashMap<String, i64>,
    pub delivery_health: DeliveryHealth,
}

#[utoipa::path(
    get,
    path = "/v1/stats",
    tag = "Stats",
    summary = "Aggregate counters + delivery health",
    responses(
        (status = 200, description = "Aggregate counters + delivery rollup", body = StatsResponse),
        (status = 429, description = "Rate limit exceeded; see Retry-After header", body = ApiError),
        (status = 500, description = "Unexpected server error", body = ApiError)
    )
)]
pub async fn summary(State(state): State<Arc<AppState>>) -> Result<impl IntoResponse, ApiError> {
    // synth_lev (xSOL) is excluded from the public peg surface (see
    // ASSETS_LIST_SQL) — a leveraged synth has no peg, so it must not inflate
    // the "N pegged assets tracked" headline. Keeps this count == /v1/assets.
    let (assets_tracked,): (i64,) = sqlx::query_as(
        "SELECT count(*) FROM assets WHERE is_active AND class::text <> 'synth_lev'",
    )
    .fetch_one(&state.pg)
    .await
    .map_err(ApiError::db)?;

    // ADR-0020: this counter reads the same `alerts` ledger the index/feeds gate
    // keeps quiet during calibration. Zero it while FEATURE_PUBLIC_ALERTS is false
    // so the public, unauthenticated /v1/stats doesn't disclose dogfood alert
    // volume before launch. (by_state / assets_in_drift derive from
    // discount_snapshots — live engine state — and stay public.)
    let alerts_24h: i64 = if state.feature_public_alerts {
        // Beta cohort: monitoring_only assets are now publicly listed in
        // /v1/audit (no longer egress-gated), so this counter
        // includes them too and stays reconciled with those feeds. Non-public
        // classes (synth_lev, e.g. xSOL) are not indexed there, so they are
        // not counted here either.
        let (n,): (i64,) = sqlx::query_as(
            "SELECT count(*) FROM alerts \
             WHERE detected_at >= now() - INTERVAL '24 hours' \
               AND class::text <> ALL($1::text[])",
        )
        .bind(
            crate::schema::NON_PUBLIC_CLASSES
                .iter()
                .map(|c| c.to_string())
                .collect::<Vec<_>>(),
        )
        .fetch_one(&state.pg)
        .await
        .map_err(ApiError::db)?;
        n
    } else {
        0
    };

    // by_state is the latest state per asset, GATED to the active registry so it
    // reconciles with assets_tracked (which counts `WHERE is_active`). Without
    // the JOIN, a soft-deleted asset that still has preserved snapshots
    // (pbUSDC/dSOL) is counted here but not in assets_tracked — the historical
    // 21-vs-22 off-by-one, which also leaked a false DRIFT into assets_in_drift
    // below. The JOIN is 1:1 (assets.symbol is PK; discount_snapshots.asset is
    // its FK), so counts stay exact.
    //
    // Freshness (2026-07-23): the LATERAL carries the SAME 15-min bound as the
    // /v1/assets `d` LATERAL (routes/assets.rs `ds.ts >= now() - INTERVAL '15
    // minutes'`), and a stale/absent latest snapshot collapses to UNKNOWN via
    // the LEFT LATERAL + COALESCE. Previously this query had NO freshness bound
    // and an INNER LATERAL, so a dark feed (e.g. sUSD stale for >15 min) was
    // silently counted in its last raw state (PEGGED) here while /v1/assets and
    // /v1/assets/{symbol}/state both collapsed it to UNKNOWN — the public
    // aggregate then read a dead feed as healthy, violating "missing data is not
    // confirming data" (ADR-0019) on the one surface the trust strip renders.
    // LEFT (not INNER) LATERAL + COALESCE(state, 'UNKNOWN') also makes the sum
    // of by_state == assets_tracked exactly: every active asset lands in exactly
    // one bucket (UNKNOWN if it has no fresh snapshot), matching how /v1/assets
    // shows the same asset. /readyz.last_snapshot_age_secs stays the system-wide
    // staleness backstop; this is the per-asset one the aggregate needs.
    //
    // Perf: per-active-asset latest state via a LATERAL index-seek on the
    // discount_snapshots PK (asset, ts) — 26 seeks instead of a full-index
    // `DISTINCT ON (asset) … ORDER BY asset, ts DESC`, which sorted the entire
    // ~3.4M-row hypertable (~2.65s, EXPLAIN 2026-06-19), at ~2.5ms. The 15-min
    // bound only tightens the per-seek range, so it stays an index-seek.
    let state_rows: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT COALESCE(d.state::text, 'UNKNOWN') AS state, count(*)
        FROM assets a
        LEFT JOIN LATERAL (
            SELECT state
            FROM discount_snapshots ds
            WHERE ds.asset = a.symbol
              AND ds.ts >= now() - INTERVAL '15 minutes'
            ORDER BY ds.ts DESC
            LIMIT 1
        ) d ON true
        WHERE a.is_active AND a.class::text <> 'synth_lev'
        GROUP BY COALESCE(d.state::text, 'UNKNOWN')
        "#,
    )
    .fetch_all(&state.pg)
    .await
    .map_err(ApiError::db)?;

    let by_state: HashMap<_, _> = state_rows.into_iter().collect();
    let assets_in_drift = by_state.get("DRIFT").copied().unwrap_or(0);

    // Delivery health rollup. `failed_24h` counts only un-acknowledged
    // failures so ops can clear the dashboard banner by acking known /
    // resolved incidents (UPDATE alert_deliveries SET acknowledged_at =
    // NOW()). `sent_24h` is total successful deliveries (no ack filter)
    // so the success-rate read of the API stays honest.
    let (sent_24h, failed_24h): (i64, i64) = sqlx::query_as(
        r#"
        SELECT
          count(*) FILTER (WHERE status = 'sent')                                AS sent,
          count(*) FILTER (WHERE status = 'failed' AND acknowledged_at IS NULL)  AS failed
        FROM alert_deliveries
        WHERE attempted_at >= now() - INTERVAL '24 hours'
        "#,
    )
    .fetch_one(&state.pg)
    .await
    .map_err(ApiError::db)?;

    let last_failure_error: Option<String> = if failed_24h > 0 {
        sqlx::query_scalar::<_, Option<String>>(
            r#"
            SELECT left(error, 200)
            FROM alert_deliveries
            WHERE status = 'failed'
              AND acknowledged_at IS NULL
              AND attempted_at >= now() - INTERVAL '24 hours'
            ORDER BY attempted_at DESC
            LIMIT 1
            "#,
        )
        .fetch_optional(&state.pg)
        .await
        .map_err(ApiError::db)?
        .flatten()
        .map(|s| redact_chat_ids(&s))
    } else {
        None
    };

    // /v1/stats aggregates change on the order of seconds. A 10s shared
    // cache + 20s SWR halves DB load when many dashboard tabs are open
    // without introducing user-visible staleness (the dashboard's own
    // refresh cadence is 30s).
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=10, stale-while-revalidate=20"),
    );

    Ok((
        headers,
        Json(StatsResponse {
            assets_tracked,
            assets_in_drift,
            alerts_24h,
            by_state,
            delivery_health: DeliveryHealth {
                sent_24h,
                failed_24h,
                last_failure_error,
            },
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_preserves_short_digit_runs() {
        // Dates, version numbers, small counts — 5 or fewer digits stay.
        assert_eq!(redact_chat_ids("2026-05-25"), "2026-05-25");
        assert_eq!(redact_chat_ids("v0.1.0"), "v0.1.0");
        assert_eq!(redact_chat_ids("12345"), "12345");
    }

    #[test]
    fn redact_strips_chat_id_shaped_runs() {
        assert_eq!(
            redact_chat_ids("chat_id=1234567890 failed"),
            "chat_id=[REDACTED_ID] failed"
        );
        assert_eq!(
            redact_chat_ids("Forbidden: bot was blocked by 987654321"),
            "Forbidden: bot was blocked by [REDACTED_ID]"
        );
    }

    #[test]
    fn redact_handles_no_digits() {
        assert_eq!(
            redact_chat_ids("Bad Request: can't parse entities"),
            "Bad Request: can't parse entities"
        );
    }
}
