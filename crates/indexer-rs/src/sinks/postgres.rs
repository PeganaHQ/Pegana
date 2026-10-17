//! Postgres write helpers. Idempotent upserts on `(asset, source, ts)` etc.

use anyhow::Result;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use sqlx::PgPool;

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

/// Observation stats over the last `window_secs` of USD* NAV history — the input
/// to the Perena nav-accrual-stall liveness signal (ADR-0038). A frozen backing
/// must be distinguished from a mere OBSERVATION gap: measuring "time since the
/// NAV last moved" by wall-clock would false-fire after a >window indexer/DB
/// outage (the on-chain NAV kept accruing, we just weren't polling). So instead
/// we ask whether the NAV was flat across a window we actually **spanned** and
/// **continuously observed** — see `nav_accrual_stale`. Returns `None` on query
/// error → caller fails OPEN.
pub struct PerenaNavStats {
    /// Distinct NAV values seen in the window. `1` ⇒ flat; `>=2` ⇒ it moved.
    pub distinct_navs: i64,
    /// Age (secs) of the OLDEST poll in the window. `< ~window` ⇒ a cold start
    /// that hasn't accumulated a full window yet → not judgeable.
    pub oldest_age_secs: i64,
    /// Largest gap (secs) between consecutive polls in the window. A big gap is
    /// an OUTAGE — a "flat" span across it was unobserved, not a proven freeze.
    pub max_gap_secs: i64,
    /// Poll count in the window. `<= 1` ⇒ too thin to judge.
    pub poll_count: i64,
}

pub async fn perena_nav_window_stats(pg: &PgPool, window_secs: i64) -> Option<PerenaNavStats> {
    sqlx::query_as::<_, (i64, i64, i64, i64)>(
        r#"
        WITH w AS (
            SELECT ts, value_usd,
                   ts - LAG(ts) OVER (ORDER BY ts) AS gap
            FROM intrinsic_snapshots
            WHERE asset = 'USD*' AND source = 'perena'
              AND ts > now() - make_interval(secs => $1)
        )
        SELECT
            count(DISTINCT value_usd)::bigint AS distinct_navs,
            coalesce(extract(epoch FROM (now() - min(ts)))::bigint, 0) AS oldest_age_secs,
            coalesce(extract(epoch FROM max(gap))::bigint, 0) AS max_gap_secs,
            count(*)::bigint AS poll_count
        FROM w
        "#,
    )
    .bind(window_secs as f64)
    .fetch_one(pg)
    .await
    .ok()
    .map(
        |(distinct_navs, oldest_age_secs, max_gap_secs, poll_count)| PerenaNavStats {
            distinct_navs,
            oldest_age_secs,
            max_gap_secs,
            poll_count,
        },
    )
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
