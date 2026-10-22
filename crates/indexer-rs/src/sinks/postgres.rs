//! Postgres write helpers. Idempotent upserts on `(asset, source, ts)` etc.

use anyhow::Result;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use sqlx::PgPool;
use std::collections::HashMap;

pub async fn insert_intrinsic(
    pg: &PgPool,
    asset: &str,
    value_usd: Decimal,
    source: &str,
    meta: serde_json::Value,
    slot: Option<i64>,
    ts: DateTime<Utc>,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO intrinsic_snapshots (asset, value_usd, source, meta, slot, ts)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (asset, source, ts) DO NOTHING
        "#,
    )
    .bind(asset)
    .bind(value_usd)
    .bind(source)
    .bind(meta)
    .bind(slot)
    .bind(ts)
    .execute(pg)
    .await?;
    Ok(())
}

/// Upsert the intrinsic-liveness signal (migration 0068, ADR-0038) — one row
/// per covered asset, refreshed each poll. The engine's intrinsic-liveness gate
/// reads `stale` (freshness-guarded) and force-UNKNOWNs a stale backing when the
/// gate is enabled. `reason` = `'directory_stale'` (lst_directory_audit) or
/// `'epoch_lag'` (spl_stake_pool + hylo hyUSD/xSOL); `detail` carries forensics.
/// Observe-only until the gate is enabled — safe to write unconditionally.
pub async fn upsert_intrinsic_liveness(
    pg: &PgPool,
    asset: &str,
    stale: bool,
    reason: &str,
    detail: serde_json::Value,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO intrinsic_liveness (asset, stale, reason, detail, updated_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (asset) DO UPDATE SET
          stale = EXCLUDED.stale,
          reason = EXCLUDED.reason,
          detail = EXCLUDED.detail,
          updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(asset)
    .bind(stale)
    .bind(reason)
    .bind(detail)
    .execute(pg)
    .await?;
    Ok(())
}

/// OR-merge rule for the single-row-per-asset `intrinsic_liveness` table: a
/// writer may touch the row only if it is absent, not currently stale, or already
/// owned by the same `reason`. A stale row owned by ANOTHER detector is never
/// overwritten (neither by a stale=false nor by a different stale=true).
pub fn liveness_write_allowed(existing: Option<(bool, &str)>, new_reason: &str) -> bool {
    match existing {
        None => true,
        Some((stale, reason)) => !stale || reason == new_reason,
    }
}

/// [`upsert_intrinsic_liveness`] honoring [`liveness_write_allowed`]. Returns
/// whether the row was written.
pub async fn upsert_intrinsic_liveness_guarded(
    pg: &PgPool,
    asset: &str,
    stale: bool,
    reason: &str,
    detail: serde_json::Value,
) -> Result<bool> {
    let existing: Option<(bool, String)> =
        sqlx::query_as("SELECT stale, reason FROM intrinsic_liveness WHERE asset = $1")
            .bind(asset)
            .fetch_optional(pg)
            .await?;
    if !liveness_write_allowed(existing.as_ref().map(|(s, r)| (*s, r.as_str())), reason) {
        return Ok(false);
    }
    upsert_intrinsic_liveness(pg, asset, stale, reason, detail).await?;
    Ok(true)
}

/// Clear an intrinsic-liveness stale flag, but ONLY if the row still carries one
/// of `reasons` — so a recovery in one detector never erases the stale signal
/// another detector (directory_stale, epoch_lag, nav_update_stale, ...) wrote.
pub async fn clear_intrinsic_liveness_if_reasons(
    pg: &PgPool,
    asset: &str,
    reasons: &[&str],
) -> Result<()> {
    let reasons: Vec<String> = reasons.iter().map(|r| r.to_string()).collect();
    sqlx::query(
        r#"
        UPDATE intrinsic_liveness
        SET stale = FALSE, updated_at = now()
        WHERE asset = $1 AND reason = ANY($2) AND stale
        "#,
    )
    .bind(asset)
    .bind(&reasons)
    .execute(pg)
    .await?;
    Ok(())
}

/// Append a liquidity observation. `liquidity_usd` is `None` for a
/// `has_market=false` mint or a junk tick — Phase 0 records those too so the
/// depth-gate floor (Spec 04 Phase 1) is calibrated from the real distribution.
/// Idempotent on `(asset, source, ts)`.
pub async fn insert_liquidity_observation(
    pg: &PgPool,
    asset: &str,
    source: &str,
    liquidity_usd: Option<Decimal>,
    has_market: bool,
    ts: DateTime<Utc>,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO liquidity_observations (asset, source, liquidity_usd, has_market, ts)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (asset, source, ts) DO NOTHING
        "#,
    )
    .bind(asset)
    .bind(source)
    .bind(liquidity_usd)
    .bind(has_market)
    .bind(ts)
    .execute(pg)
    .await?;
    Ok(())
}

/// Persist one tokens.xyz market-context observation (migration 0075).
///
/// Deliberately a SEPARATE function from `insert_liquidity_observation` rather
/// than a widening of it: that one serves the 60s `market-snapshots` poll that
/// is already live in production and has none of these fields, so widening it
/// would only force `None` padding at its call site. Keeping them apart means
/// this change cannot regress the existing depth-gate series.
///
/// Every column is nullable and every argument may be `None` — NULL means "no
/// market" or "not observed", never zero (ADR-0019). `has_market` is `true`
/// because the caller only reaches here with at least one real reading.
/// Idempotent on `(asset, source, ts)`.
#[allow(clippy::too_many_arguments)]
pub async fn insert_market_context_observation(
    pg: &PgPool,
    asset: &str,
    source: &str,
    liquidity_usd: Option<Decimal>,
    volume_24h_usd: Option<Decimal>,
    market_cap_usd: Option<Decimal>,
    holder_count: Option<i64>,
    ts: DateTime<Utc>,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO liquidity_observations
            (asset, source, liquidity_usd, has_market, ts,
             volume_24h_usd, market_cap_usd, holder_count)
        VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7)
        ON CONFLICT (asset, source, ts) DO NOTHING
        "#,
    )
    .bind(asset)
    .bind(source)
    .bind(liquidity_usd)
    .bind(ts)
    .bind(volume_24h_usd)
    .bind(market_cap_usd)
    .bind(holder_count)
    .execute(pg)
    .await?;
    Ok(())
}

/// Latest intrinsic NAV (USD per unit) for an asset, within a freshness
/// window. Used by the DexScreener market source as the reference for its
/// premium sanity gate — a thin-liquidity pair's `priceUsd` is only trusted
/// when it sits near the asset's own redemption value. Returns `None` when no
/// fresh intrinsic exists (caller then skips the gate rather than blocking the
/// market on missing reference data).
pub async fn latest_intrinsic_usd(
    pg: &PgPool,
    asset: &str,
    within_secs: i64,
) -> Result<Option<Decimal>> {
    let row: Option<Decimal> = sqlx::query_scalar(
        r#"
        SELECT value_usd
        FROM intrinsic_snapshots
        WHERE asset = $1
          AND ts > now() - make_interval(secs => $2)
        ORDER BY ts DESC
        LIMIT 1
        "#,
    )
    .bind(asset)
    .bind(within_secs as f64)
    .fetch_optional(pg)
    .await?;
    Ok(row)
}

/// Latest market `value_usd` per asset, for a batch of assets, within a fresh
/// window. One query for the whole set — the Sanctum NAV drift guard needs a
/// market reference for every LST on each poll, and a per-asset query would be
/// 39 round-trips. Assets with no fresh market row are simply absent from the
/// map (the caller then cannot run the guard and fails open).
pub async fn latest_market_usd_batch(
    pg: &PgPool,
    assets: &[String],
    within_secs: i64,
) -> Result<HashMap<String, Decimal>> {
    let rows: Vec<(String, Decimal)> = sqlx::query_as(
        r#"
        SELECT DISTINCT ON (asset) asset, value_usd
        FROM market_snapshots
        WHERE asset = ANY($1)
          AND ts > now() - make_interval(secs => $2)
        ORDER BY asset, ts DESC
        "#,
    )
    .bind(assets)
    .bind(within_secs as f64)
    .fetch_all(pg)
    .await?;
    Ok(rows.into_iter().collect())
}

#[allow(clippy::too_many_arguments)]
pub async fn insert_market(
    pg: &PgPool,
    asset: &str,
    value_usd: Decimal,
    numeraire: &str,
    raw_in: Option<Decimal>,
    raw_out: Option<Decimal>,
    price_impact_pct: Option<Decimal>,
    route_label: Option<&str>,
    ts: DateTime<Utc>,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO market_snapshots
            (asset, value_usd, numeraire, raw_in, raw_out, price_impact_pct, route_label, ts)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (asset, ts) DO NOTHING
        "#,
    )
    .bind(asset)
    .bind(value_usd)
    .bind(numeraire)
    .bind(raw_in)
    .bind(raw_out)
    .bind(price_impact_pct)
    .bind(route_label)
    .bind(ts)
    .execute(pg)
    .await?;
    Ok(())
}

pub async fn insert_oracle(
    pg: &PgPool,
    feed: &str,
    feed_id: &str,
    price: Decimal,
    confidence: Option<Decimal>,
    publish_time: DateTime<Utc>,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO oracle_snapshots (feed, feed_id, price, confidence, publish_time)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (feed, publish_time) DO NOTHING
        "#,
    )
    .bind(feed)
    .bind(feed_id)
    .bind(price)
    .bind(confidence)
    .bind(publish_time)
    .execute(pg)
    .await?;
    Ok(())
}

/// Write the two `token_supply` columns (migration 0065) for one mint.
/// Purely additive/isolated — touches ONLY `circulating_supply` +
/// `supply_updated_at` on `assets`, never `discount_snapshots`,
/// `intrinsic_snapshots`, thresholds, or any calibrated value. `mint` keys
/// the row (the `assets.mint` column is the canonical on-chain identifier);
/// a mint not present in `assets` is a silent no-op (0 rows affected) rather
/// than an error — the caller iterates the same asset list that produced the
/// mint, so this should not happen, but it must not be fatal if it does.
pub async fn update_circulating_supply(
    pg: &PgPool,
    mint: &str,
    circulating_supply: Decimal,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE assets
        SET circulating_supply = $1, supply_updated_at = now()
        WHERE mint = $2
        "#,
    )
    .bind(circulating_supply)
    .bind(mint)
    .execute(pg)
    .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn insert_hylo_state(
    pg: &PgPool,
    ts: DateTime<Utc>,
    cr: Decimal,
    hyusd_supply: Decimal,
    reserve_sol: Decimal,
    reserve_usd: Decimal,
    stability_mode: i16,
    stability_pool: Decimal,
    xsol_supply: Decimal,
    raw_state: serde_json::Value,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO hylo_state_snapshots
            (ts, cr, hyusd_supply, reserve_sol, reserve_usd, stability_mode, stability_pool, xsol_supply, raw_state)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (ts) DO NOTHING
        "#,
    )
    .bind(ts)
    .bind(cr)
    .bind(hyusd_supply)
    .bind(reserve_sol)
    .bind(reserve_usd)
    .bind(stability_mode)
    .bind(stability_pool)
    .bind(xsol_supply)
    .bind(raw_state)
    .execute(pg)
    .await?;
    Ok(())
}

#[cfg(test)]
mod liveness_tests {
    use super::liveness_write_allowed as ok;

    #[test]
    fn or_merge_semantics() {
        // absent row, or a healthy row of any reason: writable
        assert!(ok(None, "a"));
        assert!(ok(Some((false, "b")), "a"));
        // stale row owned by someone else: protected from stale=true AND stale=false
        assert!(!ok(Some((true, "directory_stale")), "sanctum_nav_drift"));
        assert!(!ok(Some((true, "sanctum_nav_drift")), "directory_stale"));
        // stale row owned by the same reason: owner may refresh/clear it
        assert!(ok(Some((true, "directory_stale")), "directory_stale"));
    }
}
