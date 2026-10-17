//! sqlx queries for the webhook channel.
//!
//! Uses the runtime `sqlx::query(...) + Row::get(...)` pattern (as used
//! across the workspace) instead of the compile-time
//! `query_as!` macro — this project doesn't configure `DATABASE_URL` at
//! build time and has no checked-in `.sqlx/` query cache, so the macro
//! would break offline builds.

use anyhow::Result;
use pegana_common::webhook_channel::ChannelType;
use sqlx::{PgPool, Row};
use std::str::FromStr;
use uuid::Uuid;

/// Hydrated `webhook_subscriptions` row. `asset` + `threshold_bps`
/// are loaded for completeness (they're already part of the SELECT —
/// removing them would force a different query for any consumer that
/// wants to log them) and intentionally not consumed in the bin's hot
/// path. Suppress the dead-field warning rather than pruning fields
/// the schema already carries.
#[allow(dead_code)]
pub struct Subscription {
    pub id: Uuid,
    pub url: String,
    pub asset: String,
    pub threshold_bps: i32,
    pub channel_type: ChannelType,
}

/// All active subscriptions for `asset` whose `threshold_bps` ≤ the
/// magnitude of the incoming `discount_bps`. The caller passes the
/// signed discount (negative for below-peg); we filter by absolute
/// magnitude so users registering "alert me on |drift| ≥ 100 bps"
/// don't have to track signs.
pub async fn subs_for_asset(
    pool: &PgPool,
    asset: &str,
    discount_bps: i32,
) -> Result<Vec<Subscription>> {
    let rows = sqlx::query(
        r#"SELECT id, url, asset, threshold_bps, channel_type
           FROM webhook_subscriptions
           WHERE asset = $1 AND is_active = TRUE AND $2 >= threshold_bps"#,
    )
    .bind(asset)
    .bind(discount_bps.abs())
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| Subscription {
            id: r.get("id"),
            url: r.get("url"),
            asset: r.get("asset"),
            threshold_bps: r.get("threshold_bps"),
            channel_type: ChannelType::from_str(&r.get::<String, _>("channel_type"))
                .unwrap_or_default(),
        })
        .collect())
}

/// Beta marker: is `asset` flagged `monitoring_only` in the catalog?
///
/// HISTORY: this used to be an egress GATE that suppressed all `monitoring_only`
/// alerts. The 2026-06-16 beta release flipped the behavior from *suppress* →
/// *label*: the monitoring_only set — the Phase-0 provisional assets (JupUSD,
/// JLP, EURC, dzSOL, vSOL) plus the calibration-v1 downgrades (mSOL, INF, bbSOL,
/// hyloSOL, sHYUSD, xSOL, hyloSOL+, ONyc) — now dispatches like any calibrated
/// asset, but every delivery is stamped `beta` (Telegram footer + webhook
/// `calibration:provisional`). So this no longer suppresses anything; it only
/// derives the `beta` boolean the fan-out rides down. Anti-flap for a beta
/// BLACK_SWAN is handled separately in `process()` (it is NOT dedup-exempt).
///
/// Fail-CLOSED on the beta marker (returns `false` = "calibrated") when the
/// asset row is absent: an unknown asset is never labelled beta on a guess.
pub async fn asset_is_monitoring_only(pool: &PgPool, asset: &str) -> Result<bool> {
    let flag: Option<bool> = sqlx::query_scalar(
        r#"SELECT COALESCE((metadata->>'monitoring_only')::boolean, FALSE)
           FROM assets WHERE symbol = $1"#,
    )
    .bind(asset)
    .fetch_optional(pool)
    .await?;
    Ok(flag.unwrap_or(false))
}

pub async fn record_dispatch_result(pool: &PgPool, sub_id: Uuid, status: i16) -> Result<()> {
    sqlx::query(
        "UPDATE webhook_subscriptions
         SET last_fired_at = now(), last_status = $2
         WHERE id = $1",
    )
    .bind(sub_id)
    .bind(status)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn record_dead_letter(
    pool: &PgPool,
    sub_id: Uuid,
    alert_id: Uuid,
    payload: serde_json::Value,
    last_error: &str,
    attempts: i16,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO webhook_dead_letter
           (subscription_id, alert_id, payload, last_error, attempts)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(sub_id)
    .bind(alert_id)
    .bind(payload)
    .bind(last_error)
    .bind(attempts)
    .execute(pool)
    .await?;
    Ok(())
}
