//! /v1/assets endpoints.

use crate::error::ApiError;
use crate::extract::ValQuery;
use crate::oracle_degraded::{classify_oracle_degraded, OracleDegraded};
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue},
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use std::sync::Arc;
use utoipa::{IntoParams, ToSchema};

/// Redis key + TTL for the unfiltered `/v1/assets` list response (B-022).
/// The list is a single global object the dashboard polls on every load; at
/// p50 ~1.2s the per-asset LATERAL joins (latest snapshot + intrinsic
/// fallback + 24h sparkline) dominate. A 5s server-side cache absorbs the
/// repeated identical reads without user-visible staleness — the engine
/// only writes new snapshots on the order of seconds and the dashboard's own
/// refresh cadence is far slower. Only the *unfiltered* request is cached;
/// `?class=`/`?peg=` variants fall through to Postgres (they're rare and the
/// cardinality would dilute the hit rate).
pub(crate) const ASSETS_LIST_CACHE_KEY: &str = "v1:assets:list";
pub(crate) const ASSETS_LIST_CACHE_TTL_SECS: u64 = 5;

/// Last-known-good payload for `/v1/assets`, read ONLY when the Postgres query
/// itself fails. Deliberately a different key with a different lifetime from
/// `ASSETS_LIST_CACHE_KEY` — the two solve different problems and conflating
/// them would be a bug:
///
///   - `ASSETS_LIST_CACHE_KEY` (5s) is a latency optimisation. Missing is the
///     normal case and falls through to Postgres.
///   - This key is a DEGRADATION path. It is never consulted on a cache miss,
///     only when the database call errors, and it holds a much older payload
///     on purpose.
///
/// Ported from `withStaleFallback` in solana-foundation/tokens (MIT,
/// `apps/api/src/effect/stale-response-cache.ts`), with both of its invariants:
/// a 4xx is never masked (only the DB-failure path is wrapped, so a rejected
/// query still returns its 400), and an "unhealthy" success is never written
/// here. For this endpoint unhealthy means zero rows: with ~69 active assets an
/// empty catalogue is a broken query, not reality. That is the same failure
/// shape as the JupUSD incident, where a hollow-but-successful read poisoned
/// downstream state.
pub(crate) const ASSETS_LIST_LAST_GOOD_KEY: &str = "v1:assets:list:last-known-good";
/// How long a last-known-good payload stays servable. Long, because its only
/// competitor is a 500.
pub(crate) const ASSETS_LIST_LAST_GOOD_TTL_SECS: u64 = 24 * 60 * 60;
/// Response header stamped when the body came from the degradation path, so a
/// consumer can tell "live" from "last known good" without guessing.
pub(crate) const STALE_HEADER: &str = "x-pegana-stale";

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListQuery {
    /// Filter by asset class (e.g. `lst`, `stable_fiat`, `stable_cdp`,
    /// `stable_yield`, `synthetic_leverage`). Case-sensitive match against
    /// the engine's asset_class enum.
    pub class: Option<String>,
    /// Filter by peg target (e.g. `SOL`, `USD`, `BRL`). Matches the asset's
    /// declared peg, not its observed value.
    pub peg: Option<String>,
}

// Deserialize so `/v1/peg/feed` can rehydrate the cached (serialized) list from
// the SHARED `ASSETS_LIST_CACHE_KEY` instead of re-running the heavy LATERAL join.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AssetCard {
    pub symbol: String,
    pub name: String,
    pub mint: String,
    pub class: String,
    /// Peg anchor — how to interpret the asset's fair value without knowing
    /// Pegana's internal taxonomy.
    ///
    /// - `"USD"` — fixed $1 target (fiat-backed, RWA, delta-neutral, CDP
    ///   stablecoins). A discount from $1 IS the risk signal.
    /// - `"FX"` — fixed non-USD fiat exchange-rate peg (e.g. EURC→EUR,
    ///   BRZ→BRL). Read `peg_target` for the specific currency. A discount
    ///   from the FX rate IS the risk signal.
    /// - `"NAV"` — intrinsic redemption / net-asset value, NOT a fixed fiat
    ///   rate (LSTs, yield-bearing stables, synthetic leverage). NAV itself
    ///   moves; the discount is relative to it.
    ///
    /// Derived from `class`, NOT from `peg_target`. A yield-bearing stable can
    /// have `peg_target = "USD"` yet `anchor = "NAV"` because its fair value
    /// legitimately accrues above $1 over time.
    #[schema(value_type = crate::schema::Anchor)]
    pub anchor: String,
    pub peg_target: String,
    pub decimals: i16,
    #[schema(value_type = Option<crate::schema::PegState>)]
    pub state: Option<String>,
    #[serde(serialize_with = "crate::serde_fmt::opt_dec_norm")]
    pub discount: Option<Decimal>,

    /// Derived 0-100 peg-risk score — a single sortable/thresholdable number for
    /// integrators, ALONGSIDE (never replacing) `state`. Anchored to the committed
    /// `state` so it never disagrees with the classification (PEGGED ≤ 24, DRIFT
    /// 25-49, DEPEG 50-74, CRITICAL 75-94, BLACK_SWAN 95-100), interpolated within
    /// the band by the effective discount magnitude. `null` when `state` is
    /// UNKNOWN/absent, no discount exists, or thresholds are the CDP CR-form —
    /// we never fabricate a score (ADR-0019). Deterministic + reproducible from
    /// the other published fields; NOT part of any receipt hash. See
    /// `crates/api-rs/src/risk_score.rs`.
    #[serde(default)]
    pub risk_score: Option<u8>,

    #[serde(serialize_with = "crate::serde_fmt::opt_dec_norm")]
    pub intrinsic_usd: Option<Decimal>,
    #[serde(serialize_with = "crate::serde_fmt::opt_dec_norm")]
    pub market_usd: Option<Decimal>,
    #[serde(serialize_with = "crate::serde_fmt::opt_ts_millis_z")]
    pub updated_at: Option<DateTime<Utc>>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_round_f64_8"
    )]
    pub series_24h: Option<Vec<f64>>,

    /// Stake-pool SOL per share for Sanctum LSTs (`rust_decimal`, serialized as
    /// a JSON string). Omitted for non-LST assets. Reflects the LATEST intrinsic
    /// snapshot — read together with `updated_at` for freshness. NAV decomposition
    /// is `intrinsic_usd = sol_per_lst × SOL/USD`.
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_norm"
    )]
    pub sol_per_lst: Option<Decimal>,

    /// Pyth oracle confidence bucket: `high` | `medium` | `low` | `unknown`.
    /// Scopes the PRICE-ORACLE confidence interval only (conf/price ratio), NOT
    /// market-quote / route-depth reliability. Omitted when no discount snapshot
    /// exists yet. Reflects the LATEST snapshot — an omitted value means "no
    /// current signal" and MUST NOT be rendered as a positive bucket; the client
    /// gates on `updated_at` freshness before showing it (hardening H1/H9).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::schema::Confidence>)]
    pub confidence: Option<String>,

    /// Per-asset alert thresholds, served verbatim from `assets.thresholds`
    /// JSONB (BSRV-01). Two shapes pass through unchanged: bps-keyed
    /// `{"drift_bps","depeg_bps","critical_bps"}` for most assets, and the
    /// CDP collateral-ratio form `{"cr_drift","cr_depeg","cr_critical",
    /// "cr_black_swan"}` for hyUSD. This is the AUTHORITATIVE source the
    /// client should key band-gauge / chart threshold lines / "closest to
    /// breaking" sort off — replacing any hand-maintained client table. The
    /// column is re-synced to the engine's calibrated `assets.toml` values by
    /// migration `0042_resync_asset_thresholds`. Omitted only if the column
    /// is NULL (never, given the `NOT NULL` constraint) or fails to decode.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thresholds: Option<serde_json::Value>,

    /// True when the asset is actively monitored but excluded from the
    /// calibrated launch denominator. This is a calibration-status flag, not a
    /// health state: an asset can be `PEGGED` and `monitoring_only=true`.
    pub monitoring_only: bool,

    /// Human-readable reason for `monitoring_only=true`. Omitted for fully
    /// calibrated assets.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monitoring_reason: Option<String>,

    /// YYYY-MM-DD date when the asset entered monitoring-only status. Omitted
    /// for fully calibrated assets.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monitoring_since: Option<String>,

    /// Consumer-facing calibration label, `provisional` | `calibrated` — the
    /// self-describing form of `monitoring_only` (`provisional` ⇔
    /// `monitoring_only=true`), in the SAME vocabulary the dispatcher emits on
    /// the webhook canonical event. Always present.
    #[schema(value_type = crate::schema::Calibration)]
    pub calibration: String,

    /// Worst (largest-magnitude) absolute discount observed over the trailing
    /// 24h (BSRV-02), in the same signed-fraction units as `discount`
    /// (e.g. `0.0123` = 123 bps). Computed as
    /// `max(greatest(abs(min_discount), abs(max_discount)))` over the
    /// `discount_1m` aggregate — discount is signed, so the abs is required to
    /// catch the worst tick in EITHER direction. Trailing 24h, INDEPENDENT of
    /// the current-snapshot 15-min freshness bound on `discount`. Omitted when
    /// no `discount_1m` rows exist in the window.
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_norm"
    )]
    pub worst_abs_24h: Option<Decimal>,

    /// Peg-jitter scalar over the trailing 24h (BSRV-03): peak-to-trough
    /// dispersion of the discount, `max(max_discount) - min(min_discount)`,
    /// in the same signed-fraction units as `discount`. A cheap stability
    /// measure (always >= 0) computed server-side once per scan instead of
    /// every client recomputing it from the averaged `series_24h`. Trailing
    /// 24h, independent of the current-snapshot freshness bound. Omitted when
    /// no `discount_1m` rows exist in the window.
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_norm"
    )]
    pub jitter_bps_24h: Option<Decimal>,

    /// Seconds the asset has resided in its CURRENT committed FSM band (engine
    /// `band_since`). Omitted until the engine has stamped it. Read with `state`;
    /// `sustained` is the thresholded view (Spec 03).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_state_duration_secs: Option<i64>,
    /// True when the asset has held a committed ALERTING band (DRIFT+) long enough
    /// to be a sustained episode (a slow mechanism depeg, not a blip). A
    /// PEGGED/UNKNOWN asset is never `sustained`. Omitted until computed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sustained: Option<bool>,

    /// Advisory machine-readable reason for the snapshot's state. Explanatory
    /// only — never a verdict input and not part of any receipt hash.
    ///
    /// **Emitted today:**
    /// - `premium_sanity` — engine NAV-sanity override: smoothed discount exceeded
    ///   the premium-sanity bound, state forced to UNKNOWN (intrinsic anchor
    ///   suspect).
    /// - `stale_source` — API layer: feed is >15 min stale, state collapsed to
    ///   UNKNOWN; no fresh discount snapshot exists.
    ///
    /// **Reserved — not yet emitted (planned for depth-gate / oracle-crosscheck
    /// work):** `no_oracle_crosscheck | intrinsic_unavailable | shallow_market |
    /// nominal`.
    ///
    /// Omitted when null (most rows).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_reason: Option<String>,

    /// Which direction of `discount` is the risk signal, so a consumer reading
    /// the raw signed number knows how to interpret it. Derived from `anchor`:
    /// `"below"` for USD/FX anchors (a discount from peg is the risk),
    /// `"either"` for NAV anchors (premium and discount are both meaningful).
    #[schema(value_type = crate::schema::RiskSide)]
    pub risk_side: String,

    /// Circulating supply of the mint (`rust_decimal`, serialized as a JSON
    /// string), scaled by `decimals`. This is a SIZE/CONTEXT signal — NOT a
    /// peg-safety signal — and is NEVER an input to `discount`/`state`/
    /// thresholds. Sourced from the on-chain SPL Mint account's `supply`
    /// field by the isolated `token_supply` indexer task on a slow (~10 min)
    /// cadence (migration 0065). No freshness bound is enforced on this
    /// field the way `updated_at` is for `discount` — supply changes slowly
    /// by nature. `null` until the mint has been observed at least once —
    /// serialized as `null` (like `discount`), not omitted.
    #[serde(serialize_with = "crate::serde_fmt::opt_dec_norm")]
    pub circulating_supply: Option<Decimal>,

    /// Market capitalization in USD = `circulating_supply × market_usd` — a
    /// SIZE/CONTEXT signal for gauging relative scale across assets, NOT a
    /// peg-safety signal and NEVER an input to `discount`/`state`/thresholds.
    /// `None` whenever either factor is missing (no `circulating_supply`
    /// observed yet, or no fresh `market_usd` snapshot). Serialized as `null`
    /// (like `discount`), not omitted.
    #[serde(serialize_with = "crate::serde_fmt::opt_dec_money2")]
    pub market_cap: Option<Decimal>,

    /// Deepest-market USD liquidity, sourced from tokens.xyz's per-variant
    /// market snapshot (migration 0075). A SIZE/CONTEXT signal for judging how
    /// much size an exit can absorb, NOT a peg-safety signal and NEVER an input
    /// to `discount`/`state`/thresholds. `null` when tokens.xyz has no market
    /// for the mint (7 of 69 active assets as of 2026-08-10) or it has not been
    /// observed yet — `null` NEVER means zero (ADR-0019). Read together with
    /// `market_context_at` for freshness.
    #[serde(serialize_with = "crate::serde_fmt::opt_dec_money2")]
    pub liquidity_usd: Option<Decimal>,

    /// Trailing-24h USD trading volume, same source and same caveats as
    /// `liquidity_usd`. Context only; never a peg signal.
    #[serde(serialize_with = "crate::serde_fmt::opt_dec_money2")]
    pub volume_24h_usd: Option<Decimal>,

    /// Unique holder addresses, same source and same caveats as
    /// `liquidity_usd`. A distribution/context signal; never a peg signal.
    pub holder_count: Option<i64>,

    /// When the market-context trio above was last observed. These move on a
    /// ~30 min cadence, far slower than `updated_at`'s discount pipeline, so
    /// they carry their own timestamp rather than borrowing that one. `null`
    /// when no observation exists.
    #[serde(serialize_with = "crate::serde_fmt::opt_ts_millis_z")]
    pub market_context_at: Option<DateTime<Utc>>,

    /// Derived 0-100 market-DEPTH annotation: how executable is this asset's
    /// quoted price? Computed purely from the three context fields above (see
    /// `crates/api-rs/src/market_score.rs`), so any consumer can recompute it.
    ///
    /// NOT a peg score and NOT anchored to `state` — that is `risk_score`'s job.
    /// A deeply liquid asset trading well below NAV scores high here and DEPEG
    /// there; that disagreement is intended. Omitted when no market context has
    /// been observed at all.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub market_depth: Option<crate::market_score::MarketDepth>,

    /// Advisory, API-synthesized, OUT-OF-HASH "amber" annotation from the
    /// independent Pyth oracle leg — sits BELOW the hard Pyth-confidence gate
    /// (500bps -> UNKNOWN). Computed purely from data already on this row
    /// (see `oracle_degraded.rs`); NEVER a receipt input and NEVER touches
    /// `discount`/`state`/thresholds. Only ever populated on the
    /// single-asset detail endpoints (`/v1/assets/{symbol}` + by-mint) — the
    /// `/v1/assets` list has no oracle asof-join, so this is always omitted
    /// there. Omitted (not `null`) whenever the asset carries no subscribed
    /// oracle feed, the tick is already hard-gated to UNKNOWN, or nothing
    /// amber fired.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oracle_degraded: Option<OracleDegraded>,
}

#[utoipa::path(
    get,
    path = "/v1/assets",
    tag = "Assets",
    operation_id = "list_assets",
    summary = "List all active assets with their latest peg snapshot",
    description = "Returns every active asset with its latest discount, state, and \
                   peg-snapshot. This is the dashboard screener endpoint — for the \
                   stream of peg state-transition alerts, use `GET /v1/alerts` instead.",
    params(ListQuery),
    responses(
        (status = 200, description = "All active assets with their latest snapshot", body = crate::response::ApiList<AssetCard>),
        (status = 400, description = "Invalid query parameter", body = ApiError),
        (status = 429, description = "Rate limit exceeded — see Retry-After header", body = ApiError),
        (status = 500, description = "Unexpected server error", body = ApiError)
    )
)]
pub async fn list(
    State(state): State<Arc<AppState>>,
    ValQuery(q): ValQuery<ListQuery>,
) -> Result<impl IntoResponse, ApiError> {
    // B-022: the unfiltered list is a single global response the dashboard
    // polls constantly. Serve it from a 5s Redis cache to cut ~95% of the
    // (heavy, LATERAL-join) Postgres cost. Filtered requests skip the cache.
    let cacheable = q.class.is_none() && q.peg.is_none();

    // Same response header stats.rs sets for /v1/stats — lets downstream HTTP
    // caches (Caddy/CDN/browser) collapse repeated identical reads too.
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=5, stale-while-revalidate=10"),
    );

    // On a Redis miss/error we fall through to Postgres — the cache is a pure
    // latency optimisation, never a correctness dependency (Redis being down
    // must not take the assets list down with it).
    let mut redis_conn = if cacheable {
        state.redis.get_multiplexed_async_connection().await.ok()
    } else {
        None
    };

    if let Some(conn) = redis_conn.as_mut() {
        let hit: Option<String> = redis::cmd("GET")
            .arg(ASSETS_LIST_CACHE_KEY)
            .query_async(conn)
            .await
            .ok()
            .flatten();
        if let Some(json) = hit {
            // Cached bytes are the bare `Vec<AssetCard>` (the key is SHARED with
            // `/v1/peg/feed`, which rehydrates that shape). Wrap them in the list
            // envelope for the response; a decode failure just falls through to a
            // fresh compute (cache is a pure latency optimisation).
            if let Ok(cards) = serde_json::from_str::<Vec<AssetCard>>(&json) {
                return Ok((headers, Json(crate::response::ApiList::new(cards))).into_response());
            }
        }
    }

    // Each asset gets the latest discount_snapshot when one exists; otherwise we
    // fall back to the latest intrinsic_snapshot so NAV is at least visible
    // (state = 'UNKNOWN' until Jupiter market data is available and the engine
    // can compute a discount). Without this fallback, assets whose source
    // adapter is healthy but whose Jupiter market quote is rate-limited would
    // render as empty cards — misleading users into thinking the asset is dead.
    let fetched = fetch_assets_list(&state.pg, q.class.as_deref(), q.peg.as_deref()).await;

    let cards = match fetched {
        Ok(cards) => cards,
        Err(e) => {
            // DEGRADATION PATH. The database is down or the query failed; serve
            // the last healthy payload rather than a 500, and say so in a header
            // plus `generated_at` (stamped at the ORIGINAL compute time, not
            // now — claiming freshness we do not have would be the one thing
            // worse than the 500).
            tracing::error!(error = %e, "assets list query failed — trying last-known-good");
            metrics::counter!("pegana_api_assets_list_db_failures_total").increment(1);

            if cacheable {
                if let Some(conn) = redis_conn.as_mut() {
                    let last_good: Option<String> = redis::cmd("GET")
                        .arg(ASSETS_LIST_LAST_GOOD_KEY)
                        .query_async(conn)
                        .await
                        .ok()
                        .flatten();
                    if let Some(json) = last_good {
                        if let Ok(stored) = serde_json::from_str::<StoredLastGood>(&json) {
                            tracing::warn!(
                                cached_at = %stored.generated_at,
                                count = stored.cards.len(),
                                "serving last-known-good assets list"
                            );
                            metrics::counter!("pegana_api_assets_list_stale_served_total")
                                .increment(1);
                            let mut h = headers.clone();
                            h.insert(STALE_HEADER, HeaderValue::from_static("true"));
                            // Never let a degraded body be cached downstream.
                            h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
                            let body = crate::response::ApiList::with_generated_at(
                                stored.cards,
                                stored.generated_at,
                            );
                            return Ok((h, Json(body)).into_response());
                        }
                    }
                }
            }
            // No last-known-good available: the honest answer is still the error.
            return Err(ApiError::db(e));
        }
    };

    // Populate the cache for the unfiltered request. Serialise once here and
    // reuse the bytes both for this response and the SETEX payload so cache
    // hits return exactly what a miss would. A serialise/Redis failure is
    // non-fatal — we still serve the freshly computed list.
    if let Some(conn) = redis_conn.as_mut() {
        if let Ok(json) = serde_json::to_string(&cards) {
            let _: Result<(), _> = redis::cmd("SETEX")
                .arg(ASSETS_LIST_CACHE_KEY)
                .arg(ASSETS_LIST_CACHE_TTL_SECS)
                .arg(&json)
                .query_async::<()>(conn)
                .await;
        }

        // Refresh last-known-good ONLY from a healthy payload. An empty list is
        // a broken query, not an empty universe, so it must never become the
        // thing we fall back to.
        if assets_list_is_healthy(&cards) {
            let stored = StoredLastGood {
                generated_at: crate::serde_fmt::rfc3339_millis_z(&Utc::now()),
                cards: cards.clone(),
            };
            if let Ok(json) = serde_json::to_string(&stored) {
                let _: Result<(), _> = redis::cmd("SETEX")
                    .arg(ASSETS_LIST_LAST_GOOD_KEY)
                    .arg(ASSETS_LIST_LAST_GOOD_TTL_SECS)
                    .arg(&json)
                    .query_async::<()>(conn)
                    .await;
            }
        }
    }

    Ok((headers, Json(crate::response::ApiList::new(cards))).into_response())
}

/// The last-known-good envelope. Carries its own compute time so the degraded
/// response can report when the data was actually true.
#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct StoredLastGood {
    pub generated_at: String,
    pub cards: Vec<AssetCard>,
}

/// Is this payload worth remembering as "last known good"?
///
/// Zero rows means the query succeeded but returned nothing, which for a
/// catalogue of ~69 permanently-active assets is a broken query rather than a
/// real state of the world. Caching it would turn one bad read into a
/// long-lived wrong answer.
pub(crate) fn assets_list_is_healthy(cards: &[AssetCard]) -> bool {
    !cards.is_empty()
}

fn row_to_card(r: sqlx::postgres::PgRow) -> AssetCard {
    let class: String = r.get("class");
    let anchor = crate::schema::anchor_for_class(&class).to_string();
    let risk_side = crate::schema::risk_side_for_anchor(&anchor).to_string();
    let market_usd: Option<Decimal> = r.try_get("market_usd").ok();
    let state_reason: Option<String> = r.try_get("state_reason").ok();
    // The three oracle columns only exist on `fetch_card`'s SQL (single-asset
    // detail) — `ASSETS_LIST_SQL` has no oracle asof-join, so `try_get` on a
    // list row just misses and `.ok()` collapses to `None`, which
    // `classify_oracle_degraded`'s first guard then turns into `None` too.
    let oracle_usd: Option<Decimal> = r.try_get("oracle_usd").ok();
    let oracle_conf: Option<Decimal> = r.try_get("oracle_conf").ok();
    let oracle_age_secs: Option<i64> = r.try_get("oracle_age_secs").ok();
    let oracle_degraded = classify_oracle_degraded(
        market_usd,
        oracle_usd,
        oracle_conf,
        oracle_age_secs,
        state_reason.as_deref(),
    );
    let state: Option<String> = r.try_get("state").ok();
    let discount: Option<Decimal> = r.try_get("discount").ok();
    let thresholds: Option<serde_json::Value> = r.try_get("thresholds").ok();
    let risk_score =
        crate::risk_score::risk_score(state.as_deref(), discount, &class, thresholds.as_ref());
    AssetCard {
        symbol: r.get("symbol"),
        name: r.get("name"),
        mint: r.get("mint"),
        anchor,
        class,
        peg_target: r.get("peg_target"),
        decimals: r.get("decimals"),
        state,
        discount,
        risk_score,
        intrinsic_usd: r.try_get("intrinsic_usd").ok(),
        market_usd,
        updated_at: r.try_get("updated_at").ok(),
        series_24h: r.try_get("series_24h").ok(),
        sol_per_lst: r.try_get("sol_per_lst").ok(),
        confidence: r.try_get("confidence").ok(),
        thresholds,
        monitoring_only: r.try_get("monitoring_only").unwrap_or(false),
        monitoring_reason: r.try_get("monitoring_reason").ok(),
        monitoring_since: r.try_get("monitoring_since").ok(),
        calibration: crate::schema::calibration_label(
            r.try_get("monitoring_only").unwrap_or(false),
        )
        .into(),
        worst_abs_24h: r.try_get("worst_abs_24h").ok(),
        jitter_bps_24h: r.try_get("jitter_bps_24h").ok(),
        current_state_duration_secs: r.try_get("current_state_duration_secs").ok(),
        sustained: r.try_get("sustained").ok(),
        state_reason,
        risk_side,
        circulating_supply: r.try_get("circulating_supply").ok(),
        market_cap: r.try_get("market_cap").ok(),
        liquidity_usd: r.try_get("liquidity_usd").ok(),
        volume_24h_usd: r.try_get("volume_24h_usd").ok(),
        holder_count: r.try_get("holder_count").ok(),
        market_context_at: r.try_get("market_context_at").ok(),
        // Derived from the three fields just read — no extra DB round trip.
        // `None` (omitted) when nothing was observed, so the client can tell
        // "no market context yet" from "observed and scored".
        market_depth: {
            let liquidity_usd: Option<Decimal> = r.try_get("liquidity_usd").ok();
            let volume_24h_usd: Option<Decimal> = r.try_get("volume_24h_usd").ok();
            let holder_count: Option<i64> = r.try_get("holder_count").ok();
            if liquidity_usd.is_none() && volume_24h_usd.is_none() && holder_count.is_none() {
                None
            } else {
                Some(crate::market_score::market_depth(
                    crate::market_score::MarketDepthInput {
                        liquidity_usd,
                        volume_24h_usd,
                        holder_count,
                    },
                ))
            }
        },
        oracle_degraded,
    }
}

/// The assets-list SQL, shared by the `list` handler and the cache pre-warmer.
/// `$1` = class filter, `$2` = peg_target filter (NULL on both = the unfiltered
/// global list — the cacheable shape).
const ASSETS_LIST_SQL: &str = r#"
        SELECT
            a.symbol, a.name, a.mint, a.class::text AS class,
            a.peg_target::text AS peg_target, a.decimals,
            COALESCE(d.state::text, CASE WHEN i.value_usd IS NOT NULL THEN 'UNKNOWN' END) AS state,
            d.discount_smooth AS discount,
            COALESCE(d.intrinsic_usd, i.value_usd) AS intrinsic_usd,
            d.market_usd,
            COALESCE(d.ts, i.ts) AS updated_at,
            s.series_24h,
            i.sol_per_lst,
            d.confidence,
            a.thresholds,
            COALESCE((a.metadata->>'monitoring_only')::boolean, false) AS monitoring_only,
            a.metadata->>'monitoring_reason' AS monitoring_reason,
            a.metadata->>'monitoring_since' AS monitoring_since,
            s.worst_abs_24h,
            s.jitter_bps_24h,
            (d.extra->>'current_state_duration_secs')::bigint AS current_state_duration_secs,
            (d.extra->>'sustained')::boolean AS sustained,
            -- state_reason: use the DB value for fresh rows; synthesize 'stale_source'
            -- when the discount LATERAL (d) returned NULL (feed >15min stale) but we
            -- have intrinsic data — matches what /state returns for the same asset.
            -- Mirrors Rust const STATE_REASON_STALE_SOURCE = "stale_source".
            COALESCE(d.state_reason,
                     CASE WHEN d.state IS NULL AND i.value_usd IS NOT NULL
                          THEN 'stale_source' END) AS state_reason,
            -- Size/context signal (migration 0065) — populated by the
            -- isolated `token_supply` indexer source, NOT the NAV/discount
            -- pipeline. market_cap is NULL whenever either factor is NULL
            -- (no circulating_supply observed yet, or no fresh market_usd).
            a.circulating_supply,
            (a.circulating_supply * d.market_usd) AS market_cap,
            -- Market-context signals (migration 0075) — populated by the
            -- isolated `tokens_xyz_risk` indexer source, NOT the NAV/discount
            -- pipeline. NULL means "not observed", never zero (ADR-0019).
            m.liquidity_usd, m.volume_24h_usd, m.holder_count,
            m.ts AS market_context_at
        FROM assets a
        LEFT JOIN LATERAL (
            SELECT * FROM discount_snapshots ds
            WHERE ds.asset = a.symbol
              AND ds.ts >= now() - INTERVAL '15 minutes'
            ORDER BY ds.ts DESC LIMIT 1
        ) d ON true
        LEFT JOIN LATERAL (
            SELECT value_usd, ts, (meta->>'sol_per_lst')::numeric AS sol_per_lst FROM intrinsic_snapshots ins
            WHERE ins.asset = a.symbol
            ORDER BY ins.ts DESC LIMIT 1
        ) i ON true
        LEFT JOIN LATERAL (
            -- Single trailing-24h scan of discount_1m feeds three signals:
            --   series_24h    — hourly-averaged sparkline (unchanged)
            --   worst_abs_24h — worst-magnitude tick in EITHER direction
            --                   (BSRV-02). discount is signed → abs required.
            --   jitter_bps_24h — peak-to-trough dispersion (BSRV-03).
            -- The per-hour min/max forwarded by the inner subquery preserve the
            -- true per-minute extremes (min(min_discount)/max(max_discount)),
            -- so max-over-hours / min-over-hours recover the exact 24h extremes
            -- without a second pass. Trailing-24h window is INDEPENDENT of the
            -- d LATERAL's 15-min current-snapshot freshness bound.
            SELECT array_agg(avg_d ORDER BY hour)::float8[] AS series_24h,
                   max(greatest(abs(hour_min), abs(hour_max))) AS worst_abs_24h,
                   (max(hour_max) - min(hour_min)) AS jitter_bps_24h
            FROM (
                SELECT time_bucket(INTERVAL '1 hour', bucket) AS hour,
                       avg(avg_discount)::float8 AS avg_d,
                       min(min_discount) AS hour_min,
                       max(max_discount) AS hour_max
                FROM discount_1m
                WHERE asset = a.symbol
                  AND bucket >= now() - INTERVAL '24 hours'
                GROUP BY hour
                ORDER BY hour
            ) t
        ) s ON true
        LEFT JOIN LATERAL (
            -- Latest tokens.xyz market-context observation. Filtered to the
            -- risk source on purpose: the 60s `tokens_xyz` market-snapshots
            -- rows leave these columns NULL and would otherwise always win the
            -- ORDER BY. Served by the partial index
            -- `liquidity_observations_enrichment_idx` (migration 0075).
            -- No freshness bound here — the source polls every 30 min and these
            -- are slow-moving context signals; the client gates on
            -- `market_context_at`, exactly as it already does for `updated_at`.
            SELECT liquidity_usd, volume_24h_usd, holder_count, ts
            FROM liquidity_observations lo
            WHERE lo.asset = a.symbol
              AND lo.source = 'tokens_xyz_risk'
            ORDER BY lo.ts DESC LIMIT 1
        ) m ON true
        WHERE a.is_active
          -- Exclude leveraged synths (synth_lev, e.g. xSOL) from the public
          -- peg-risk surface: they have NO peg — a leveraged junior tranche
          -- trades 60-85% off its own NAV BY DESIGN, so "market vs intrinsic"
          -- is a leverage premium, not peg deviation, and a "PEGGED / +84%
          -- premium" verdict reads as broken to due-diligence reviewers. Still
          -- tracked internally (already monitoring_only + excluded from the
          -- calibrated denominator, mig 0069); this is a serve-layer removal,
          -- not a methodology change. Covers /v1/assets + /v1/peg/feed (both
          -- read fetch_assets_list). Analysis: xSOL keep/remove, 2026-07-23.
          AND a.class::text <> 'synth_lev'
          AND ($1::text IS NULL OR a.class::text = $1)
          AND ($2::text IS NULL OR a.peg_target::text = $2)
        ORDER BY a.class, a.symbol
        "#;

/// Run the assets-list query and map rows to cards. `class`/`peg` filter when
/// `Some`; `None`/`None` is the unfiltered global list.
pub async fn fetch_assets_list(
    pg: &PgPool,
    class: Option<&str>,
    peg: Option<&str>,
) -> Result<Vec<AssetCard>, sqlx::Error> {
    let rows = sqlx::query(ASSETS_LIST_SQL)
        .bind(class)
        .bind(peg)
        .fetch_all(pg)
        .await?;
    Ok(rows.into_iter().map(row_to_card).collect())
}

/// Recompute the unfiltered assets list and write it to the shared Redis cache
/// under the handler's key/TTL. The background pre-warmer calls this just under
/// the TTL so the cache never expires cold — no user request pays the cold
/// Postgres (LATERAL-join) cost. Best-effort + read-only; a Redis/DB hiccup
/// only means the next user request repopulates via the handler's read-through.
pub async fn refresh_assets_list_cache(pg: &PgPool, redis: &redis::Client) -> anyhow::Result<()> {
    let cards = fetch_assets_list(pg, None, None).await?;
    let json = serde_json::to_string(&cards)?;
    let mut conn = redis.get_multiplexed_async_connection().await?;
    redis::cmd("SETEX")
        .arg(ASSETS_LIST_CACHE_KEY)
        .arg(ASSETS_LIST_CACHE_TTL_SECS)
        .arg(&json)
        .query_async::<()>(&mut conn)
        .await?;
    Ok(())
}

#[utoipa::path(
    get,
    path = "/v1/assets/{symbol}",
    tag = "Assets",
    operation_id = "asset_detail",
    summary = "Get an asset by symbol",
    params(
        ("symbol" = String, Path, description = "Asset symbol — case-insensitive; resolved to canonical casing (e.g. `jitoSOL`, `USDC`, `hyUSD`)")
    ),
    responses(
        (status = 200, description = "Latest snapshot for the asset", body = AssetCard),
        (status = 404, description = "Asset symbol unknown or inactive", body = ApiError)
    )
)]
pub async fn detail(
    State(state): State<Arc<AppState>>,
    Path(symbol): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let canonical = resolve_symbol(&state.pg, &symbol)
        .await?
        .ok_or_else(|| ApiError::unknown_asset(&symbol))?;
    let card = fetch_card(&state.pg, "a.symbol", &canonical)
        .await?
        .ok_or_else(|| ApiError::unknown_asset(&symbol))?;
    Ok(card_response(card))
}

#[utoipa::path(
    get,
    path = "/v1/assets/by-mint/{mint}",
    tag = "Assets",
    summary = "Get an asset by mint address",
    params(
        ("mint" = String, Path, description = "SPL mint address (base58) — the canonical on-chain identifier. Resolves to the same card as /v1/assets/{symbol}.")
    ),
    responses(
        (status = 200, description = "Latest snapshot for the asset", body = AssetCard),
        (status = 404, description = "No active asset with that mint", body = ApiError)
    )
)]
pub async fn detail_by_mint(
    State(state): State<Arc<AppState>>,
    Path(mint): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let card = fetch_card(&state.pg, "a.mint", &mint)
        .await?
        .ok_or_else(|| ApiError::unknown_asset(&mint))?;
    Ok(card_response(card))
}

// ── Sub-C Loop Intelligence — advisory leverage exposure (ADR-0036 variant A) ──
// A read-only rollup of `loop_exposure_snapshots` (written by protocol-indexer-ts
// from anonymous, aggregate protocol data). ADVISORY analytics — never a receipt
// input, no methodology version. `position_bucket` is a k-floored range.

/// One protocol's latest leverage rollup for an asset.
#[derive(Serialize, ToSchema, sqlx::FromRow)]
pub struct LoopByProtocol {
    pub protocol: String,
    /// Leveraged collateral (USD) — the "loop" exposure to this asset.
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_money2"
    )]
    pub collateral_lev_usd: Option<Decimal>,
    /// Total collateral supplied (USD), of which `collateral_lev_usd` is leveraged.
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_money2"
    )]
    pub collateral_usd: Option<Decimal>,
    /// Asset borrowed/shorted (USD).
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_money2"
    )]
    pub debt_usd: Option<Decimal>,
    /// k-floored obligation-count RANGE (ADR-0036 inv.7 — never a raw count).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[sqlx(rename = "position_bucket")]
    pub positions: Option<String>,
    pub coverage: String,
    #[serde(serialize_with = "crate::serde_fmt::ts_millis_z")]
    ts: DateTime<Utc>,
}

/// Cross-protocol leverage exposure for an asset.
#[derive(Serialize, ToSchema)]
pub struct LoopExposureResponse {
    pub asset: String,
    /// Σ leveraged collateral (USD) across covered protocols.
    #[serde(serialize_with = "crate::serde_fmt::dec_money2")]
    pub loop_exposure_usd: Decimal,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_money2"
    )]
    pub collateral_usd: Option<Decimal>,
    #[serde(serialize_with = "crate::serde_fmt::dec_money2")]
    pub debt_usd: Decimal,
    /// `full` | `partial` | `unknown` — worst across covered protocols.
    pub coverage: String,
    pub by_protocol: Vec<LoopByProtocol>,
    /// Depeg-cascade across the preset shock grid ($0 → $Nm as the depeg deepens),
    /// so a client renders the whole stress ladder from one call. Empty when no HF
    /// distribution has been enumerated for this asset.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub cascade: Vec<CascadeRung>,
    /// RFC3339 of the freshest protocol snapshot (absent when no data).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    /// ADR-0036 inv.9 — this is a model estimate, not a verifiable receipt.
    pub advisory_note: String,
}

#[utoipa::path(
    get,
    path = "/v1/assets/{symbol}/loop-exposure",
    tag = "Assets",
    operation_id = "asset_loop_exposure",
    summary = "Cross-protocol leverage exposure for an asset (advisory)",
    params(
        ("symbol" = String, Path, description = "Asset symbol — case-insensitive.")
    ),
    responses(
        (status = 200, description = "Latest leverage-exposure rollup (empty + coverage:unknown when no data)", body = LoopExposureResponse),
        (status = 404, description = "Asset symbol unknown or inactive", body = ApiError)
    )
)]
pub async fn loop_exposure(
    State(state): State<Arc<AppState>>,
    Path(symbol): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let canonical = resolve_symbol(&state.pg, &symbol)
        .await?
        .ok_or_else(|| ApiError::unknown_asset(&symbol))?;

    // Latest row per protocol for this asset.
    let rows = sqlx::query_as::<_, LoopByProtocol>(
        "SELECT DISTINCT ON (protocol) protocol, collateral_lev_usd, collateral_usd, \
         debt_usd, position_bucket, coverage, ts \
         FROM loop_exposure_snapshots WHERE asset = $1 ORDER BY protocol, ts DESC",
    )
    .bind(&canonical)
    .fetch_all(&state.pg)
    .await
    .map_err(ApiError::db)?;

    // Latest HF bands for this asset → the depeg-cascade ladder (one call).
    let bands = sqlx::query_as::<_, HfBandRow>(
        "SELECT DISTINCT ON (protocol, hf_band) protocol, hf_band, collateral_usd, \
         position_bucket, ts FROM loop_hf_distribution WHERE asset = $1 \
         ORDER BY protocol, hf_band, ts DESC",
    )
    .bind(&canonical)
    .fetch_all(&state.pg)
    .await
    .map_err(ApiError::db)?;
    let cascade = cascade_over_bands(&bands);

    let mut loop_exposure_usd = Decimal::ZERO;
    let mut debt_usd = Decimal::ZERO;
    let mut collateral_usd = Decimal::ZERO;
    let mut as_of: Option<DateTime<Utc>> = None;
    let mut coverage = if rows.is_empty() { "unknown" } else { "full" };
    for r in &rows {
        loop_exposure_usd += r.collateral_lev_usd.unwrap_or(Decimal::ZERO);
        debt_usd += r.debt_usd.unwrap_or(Decimal::ZERO);
        collateral_usd += r.collateral_usd.unwrap_or(Decimal::ZERO);
        as_of = Some(as_of.map_or(r.ts, |m| m.max(r.ts)));
        if r.coverage != "full" {
            coverage = "partial";
        }
    }
    // Bands can be fresher than the exposure snapshot — advance as_of over them too.
    for b in &bands {
        as_of = Some(as_of.map_or(b.ts, |m| m.max(b.ts)));
    }
    // The cascade is built from k-floored, dominance-suppressed bands, so once we
    // attach it the rollup is no longer a full accounting — report `partial`,
    // matching simulate_depeg + the feed's systemic block (honest floor).
    if !bands.is_empty() && coverage == "full" {
        coverage = "partial";
    }

    let body = LoopExposureResponse {
        asset: canonical,
        loop_exposure_usd,
        collateral_usd: (!rows.is_empty()).then_some(collateral_usd),
        debt_usd,
        coverage: coverage.to_string(),
        by_protocol: rows,
        cascade,
        updated_at: as_of.map(|t| crate::serde_fmt::rfc3339_millis_z(&t)),
        advisory_note: "advisory model estimate — not a verifiable receipt".to_string(),
    };

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=5, stale-while-revalidate=10"),
    );
    Ok((headers, Json(body)))
}

// ── Sub-C simulate-depeg — the cascade model (ADR-0036 variant A) ──────────────
// Reads the k-floored `loop_hf_distribution` bands and applies a single
// re-pricing pass: a collateral shock `s` raises each band's effective LTV, so a
// band at midpoint health-factor `h` liquidates once `h·(1−s) < 1`. ADVISORY
// estimate — coarse-rounded, positions bucketed, preset shock grid only, walled
// off from the signed receipt. Bad-debt (slippage/profitability) is a documented
// v1 gap (needs the materialized DEX slippage curve).

/// ADR-0036 inv.8 — only these shocks are accepted (no continuous sweep).
const SHOCK_BPS_GRID: [i32; 5] = [100, 250, 500, 1000, 2000];

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SimulateDepegQuery {
    /// Collateral shock in bps. Must be one of {100, 250, 500, 1000, 2000}.
    pub shock_bps: i32,
}

/// Representative health-factor at the midpoint of a band label.
fn band_mid_hf(band: &str) -> f64 {
    match band {
        "<1.0" => 0.99,
        "1.0-1.05" => 1.025,
        "1.05-1.1" => 1.075,
        "1.1-1.25" => 1.175,
        _ => 2.0, // ">1.25" — won't cross at the grid's shocks
    }
}

#[derive(sqlx::FromRow)]
struct HfBandRow {
    protocol: String,
    hf_band: String,
    collateral_usd: Decimal,
    position_bucket: String,
    ts: DateTime<Utc>,
}

#[derive(Serialize, ToSchema)]
pub struct SimulateByProtocol {
    pub protocol: String,
    #[serde(serialize_with = "crate::serde_fmt::dec_money2")]
    pub liquidatable_usd: Decimal,
    pub positions: String,
}

/// One rung of the depeg-cascade at a preset shock — the compact form carried by
/// the `/loop-exposure` endpoint and the tokens.xyz feed's `systemic` block so a
/// consumer gets the whole escalation ($0 → $Nm as the depeg deepens) in one read.
#[derive(Debug, Serialize, ToSchema, Clone)]
pub struct CascadeRung {
    pub shock_bps: i32,
    /// Collateral (USD) whose bands cross their liquidation threshold at this shock.
    #[serde(serialize_with = "crate::serde_fmt::dec_money2")]
    pub liquidatable_usd: Decimal,
    /// Bucketed range of affected positions (ADR-0036 inv.8 — never a raw count).
    pub positions: String,
}

#[derive(Serialize, ToSchema)]
pub struct SimulateDepegResponse {
    pub asset: String,
    pub shock_bps: i32,
    /// Total leveraged collateral across protocols (context, from loop-exposure).
    #[serde(serialize_with = "crate::serde_fmt::dec_money2")]
    pub loop_exposure_usd: Decimal,
    /// Collateral (USD) in bands that cross their liquidation threshold at this shock.
    #[serde(serialize_with = "crate::serde_fmt::dec_money2")]
    pub liquidatable_usd: Decimal,
    /// Bucketed range of affected positions (ADR-0036 inv.8 — never a raw count).
    pub positions: String,
    /// `full` | `partial` | `unknown`. `partial` whenever risky bands were
    /// k-floor-dropped or dominance-suppressed (the honest ADR-0036 posture).
    pub coverage: String,
    pub by_protocol: Vec<SimulateByProtocol>,
    /// ADR-0036 inv.9 — advisory model estimate, not a verifiable receipt.
    pub advisory_note: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Coarsen a set of k-floored bucket labels to one ADR-0036 inv.8 range.
fn coarse_bucket(buckets: &[String]) -> String {
    if buckets.iter().any(|b| b == ">50") {
        ">50".to_string()
    } else if buckets.iter().any(|b| b == "20-50" || b == "5-20") {
        "5-20".to_string()
    } else {
        "<5".to_string()
    }
}

/// The single-shock liquidation rollup over the k-floored bands — the shared core
/// of both `simulate_depeg` (one shock, full per-protocol breakdown) and
/// `cascade_over_bands` (every preset shock, compact rungs). A band at midpoint
/// health-factor `h` liquidates once the collateral shock `s` drives `h·(1−s) < 1`.
fn liquidatable_at_shock(
    bands: &[HfBandRow],
    shock_bps: i32,
) -> (Decimal, Vec<SimulateByProtocol>, String) {
    let s = shock_bps as f64 / 10_000.0;
    let mut per_protocol: std::collections::BTreeMap<String, (Decimal, Vec<String>)> =
        std::collections::BTreeMap::new();
    for b in bands {
        if band_mid_hf(&b.hf_band) * (1.0 - s) < 1.0 {
            let e = per_protocol.entry(b.protocol.clone()).or_default();
            e.0 += b.collateral_usd;
            e.1.push(b.position_bucket.clone());
        }
    }
    let mut liquidatable_usd = Decimal::ZERO;
    let mut all_buckets: Vec<String> = Vec::new();
    let by_protocol: Vec<SimulateByProtocol> = per_protocol
        .into_iter()
        .map(|(protocol, (usd, buckets))| {
            liquidatable_usd += usd;
            all_buckets.extend(buckets.iter().cloned());
            SimulateByProtocol {
                protocol,
                liquidatable_usd: usd,
                positions: coarse_bucket(&buckets),
            }
        })
        .collect();
    (liquidatable_usd, by_protocol, coarse_bucket(&all_buckets))
}

/// The full depeg cascade across every preset shock — used by `/loop-exposure`
/// and the feed's `systemic` block. Empty bands ⇒ all-zero rungs (honest: exposure
/// exists but no risky HF distribution has been enumerated yet).
fn cascade_over_bands(bands: &[HfBandRow]) -> Vec<CascadeRung> {
    SHOCK_BPS_GRID
        .iter()
        .map(|&shock_bps| {
            let (liquidatable_usd, _by_protocol, positions_affected) =
                liquidatable_at_shock(bands, shock_bps);
            CascadeRung {
                shock_bps,
                liquidatable_usd,
                positions: positions_affected,
            }
        })
        .collect()
}

// ── Sub-C systemic summary for the tokens.xyz feed ─────────────────────────────
// The per-asset leverage exposure + depeg-cascade, packaged for /v1/peg/feed. An
// ADVISORY model estimate (ADR-0036 inv.9), namespaced under `systemic` and
// explicitly noted so it never blurs the feed's verifiable peg fields.

/// One asset's systemic-exposure summary. Omitted from the feed when the asset
/// carries no tracked leverage.
#[derive(Debug, Serialize, ToSchema, Clone)]
pub struct SystemicSignal {
    /// Σ leveraged collateral (USD) across covered lending protocols.
    #[serde(serialize_with = "crate::serde_fmt::dec_money2")]
    pub loop_exposure_usd: Decimal,
    /// Covered protocols (e.g. `kamino`, `jupiter_lend`).
    pub protocols: Vec<String>,
    /// Depeg-cascade across the preset shock grid.
    pub cascade: Vec<CascadeRung>,
    /// `full` | `partial` | `unknown` — worst across covered protocols.
    pub coverage: String,
    /// RFC3339 of the freshest underlying snapshot.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    /// ADR-0036 inv.9 — advisory, not a verifiable receipt.
    pub advisory_note: String,
}

#[derive(sqlx::FromRow)]
struct ExposureBatchRow {
    asset: String,
    protocol: String,
    collateral_lev_usd: Option<Decimal>,
    coverage: String,
    ts: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct HfBandBatchRow {
    asset: String,
    protocol: String,
    hf_band: String,
    collateral_usd: Decimal,
    position_bucket: String,
    ts: DateTime<Utc>,
}

impl HfBandBatchRow {
    fn into_band(self) -> HfBandRow {
        HfBandRow {
            protocol: self.protocol,
            hf_band: self.hf_band,
            collateral_usd: self.collateral_usd,
            position_bucket: self.position_bucket,
            ts: self.ts,
        }
    }
}

/// One asset's latest exposure row, flattened: (protocol, leveraged collateral
/// USD, coverage, snapshot ts).
type ExposureTuple = (String, Option<Decimal>, String, DateTime<Utc>);

/// Pure: assemble one asset's `SystemicSignal` from its latest exposure rows + HF
/// bands. `None` when there's no meaningful leverage (so the feed omits it).
fn build_systemic(exposure: &[ExposureTuple], bands: &[HfBandRow]) -> Option<SystemicSignal> {
    if exposure.is_empty() {
        return None;
    }
    let mut loop_exposure_usd = Decimal::ZERO;
    let mut protocols: Vec<String> = Vec::new();
    let mut coverage = "full";
    let mut as_of: Option<DateTime<Utc>> = None;
    for (protocol, lev, cov, ts) in exposure {
        loop_exposure_usd += lev.unwrap_or(Decimal::ZERO);
        if !protocols.contains(protocol) {
            protocols.push(protocol.clone());
        }
        if cov != "full" {
            coverage = "partial";
        }
        as_of = Some(as_of.map_or(*ts, |m| m.max(*ts)));
    }
    // No leveraged collateral → not a systemic exposure; omit it from the feed.
    if loop_exposure_usd <= Decimal::ZERO {
        return None;
    }
    for b in bands {
        as_of = Some(as_of.map_or(b.ts, |m| m.max(b.ts)));
    }
    // A cascade is built from k-floored, dominance-suppressed bands, so it is
    // never a complete accounting — report `partial` whenever bands exist, so the
    // feed's systemic block never overclaims vs. `simulate_depeg` (honest floor).
    if !bands.is_empty() {
        coverage = "partial";
    }
    Some(SystemicSignal {
        loop_exposure_usd,
        protocols,
        cascade: cascade_over_bands(bands),
        coverage: coverage.to_string(),
        updated_at: as_of.map(|t| crate::serde_fmt::rfc3339_millis_z(&t)),
        advisory_note: "advisory model estimate — not a verifiable receipt".to_string(),
    })
}

/// Batch `asset → SystemicSignal` for every leveraged asset — one pair of queries
/// for the whole feed. Assets with no leverage are simply absent from the map.
pub async fn systemic_signal_map(
    pg: &PgPool,
) -> Result<HashMap<String, SystemicSignal>, sqlx::Error> {
    let exposure = sqlx::query_as::<_, ExposureBatchRow>(
        "SELECT DISTINCT ON (asset, protocol) asset, protocol, collateral_lev_usd, coverage, ts \
         FROM loop_exposure_snapshots ORDER BY asset, protocol, ts DESC",
    )
    .fetch_all(pg)
    .await?;
    let bands = sqlx::query_as::<_, HfBandBatchRow>(
        "SELECT DISTINCT ON (asset, protocol, hf_band) asset, protocol, hf_band, collateral_usd, \
         position_bucket, ts FROM loop_hf_distribution ORDER BY asset, protocol, hf_band, ts DESC",
    )
    .fetch_all(pg)
    .await?;

    let mut exp_by_asset: HashMap<String, Vec<ExposureTuple>> = HashMap::new();
    for r in exposure {
        exp_by_asset.entry(r.asset).or_default().push((
            r.protocol,
            r.collateral_lev_usd,
            r.coverage,
            r.ts,
        ));
    }
    let mut bands_by_asset: HashMap<String, Vec<HfBandRow>> = HashMap::new();
    for r in bands {
        bands_by_asset
            .entry(r.asset.clone())
            .or_default()
            .push(r.into_band());
    }

    let mut map = HashMap::new();
    for (asset, exp) in exp_by_asset {
        let asset_bands = bands_by_asset.get(&asset).map(Vec::as_slice).unwrap_or(&[]);
        if let Some(sig) = build_systemic(&exp, asset_bands) {
            map.insert(asset, sig);
        }
    }
    Ok(map)
}

/// Single-asset `SystemicSignal` (for `/v1/peg/feed/by-mint`).
pub async fn systemic_signal_for(
    pg: &PgPool,
    asset: &str,
) -> Result<Option<SystemicSignal>, sqlx::Error> {
    let exposure = sqlx::query_as::<_, ExposureBatchRow>(
        "SELECT DISTINCT ON (protocol) asset, protocol, collateral_lev_usd, coverage, ts \
         FROM loop_exposure_snapshots WHERE asset = $1 ORDER BY protocol, ts DESC",
    )
    .bind(asset)
    .fetch_all(pg)
    .await?;
    let bands = sqlx::query_as::<_, HfBandRow>(
        "SELECT DISTINCT ON (protocol, hf_band) protocol, hf_band, collateral_usd, \
         position_bucket, ts FROM loop_hf_distribution WHERE asset = $1 \
         ORDER BY protocol, hf_band, ts DESC",
    )
    .bind(asset)
    .fetch_all(pg)
    .await?;
    let exp: Vec<_> = exposure
        .into_iter()
        .map(|r| (r.protocol, r.collateral_lev_usd, r.coverage, r.ts))
        .collect();
    Ok(build_systemic(&exp, &bands))
}

#[utoipa::path(
    get,
    path = "/v1/assets/{symbol}/simulate-depeg",
    tag = "Assets",
    operation_id = "asset_simulate_depeg",
    summary = "Simulate a depeg's cross-protocol liquidation cascade (advisory)",
    params(
        ("symbol" = String, Path, description = "Asset symbol — case-insensitive."),
        SimulateDepegQuery
    ),
    responses(
        (status = 200, description = "Cascade estimate for the shock", body = SimulateDepegResponse),
        (status = 400, description = "shock_bps not in {100,250,500,1000,2000}", body = ApiError),
        (status = 404, description = "Asset symbol unknown or inactive", body = ApiError)
    )
)]
pub async fn simulate_depeg(
    State(state): State<Arc<AppState>>,
    Path(symbol): Path<String>,
    ValQuery(q): ValQuery<SimulateDepegQuery>,
) -> Result<impl IntoResponse, ApiError> {
    if !SHOCK_BPS_GRID.contains(&q.shock_bps) {
        return Err(ApiError::bad_request(format!(
            "shock_bps must be one of {SHOCK_BPS_GRID:?}"
        )));
    }
    let canonical = resolve_symbol(&state.pg, &symbol)
        .await?
        .ok_or_else(|| ApiError::unknown_asset(&symbol))?;

    // Latest HF bands per (protocol, band).
    let bands = sqlx::query_as::<_, HfBandRow>(
        "SELECT DISTINCT ON (protocol, hf_band) protocol, hf_band, collateral_usd, \
         position_bucket, ts FROM loop_hf_distribution WHERE asset = $1 \
         ORDER BY protocol, hf_band, ts DESC",
    )
    .bind(&canonical)
    .fetch_all(&state.pg)
    .await
    .map_err(ApiError::db)?;

    // Context: total leveraged collateral from loop_exposure_snapshots.
    let loop_exposure_usd: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(collateral_lev_usd), 0) FROM ( \
           SELECT DISTINCT ON (protocol) protocol, collateral_lev_usd \
           FROM loop_exposure_snapshots WHERE asset = $1 ORDER BY protocol, ts DESC \
         ) t",
    )
    .bind(&canonical)
    .fetch_one(&state.pg)
    .await
    .map_err(ApiError::db)?;

    let as_of: Option<DateTime<Utc>> = bands.iter().map(|b| b.ts).max();
    let (liquidatable_usd, by_protocol, positions_affected) =
        liquidatable_at_shock(&bands, q.shock_bps);

    // Coverage: unknown with no band data at all; otherwise partial — the k-floor
    // + dominance suppression + single-pass model mean this is never a full total.
    let coverage = if bands.is_empty() {
        "unknown"
    } else {
        "partial"
    };

    let body = SimulateDepegResponse {
        asset: canonical,
        shock_bps: q.shock_bps,
        loop_exposure_usd,
        liquidatable_usd,
        positions: positions_affected,
        coverage: coverage.to_string(),
        by_protocol,
        advisory_note:
            "advisory model estimate — not a verifiable receipt; risky bands may be suppressed \
             for privacy, and bad-debt/slippage is not yet modelled"
                .to_string(),
        updated_at: as_of.map(|t| crate::serde_fmt::rfc3339_millis_z(&t)),
    };

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=5, stale-while-revalidate=10"),
    );
    Ok((headers, Json(body)))
}

/// Build the cached detail / by-mint response. The 5s shared cache mirrors
/// list()'s pattern; the header attaches only here (the Ok path), so 404s
/// stay uncached.
fn card_response(card: AssetCard) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=5, stale-while-revalidate=10"),
    );
    (headers, Json(card))
}

/// Resolve a possibly-mis-cased symbol to its canonical catalog casing via the
/// `assets_symbol_lower_uidx` functional index (migration 0045). NO is_active
/// filter — state() and history() serve preserved snapshots for soft-deleted
/// assets, so case resolution must not narrow the served set (detail() keeps
/// its own `a.is_active` in fetch_card). The canonical string is then bound
/// into the exact-case hot-table queries, so they stay on the existing
/// `asset` B-tree (no `lower()` seq-scan). Returns None when nothing matches.
async fn resolve_symbol(pg: &sqlx::PgPool, requested: &str) -> Result<Option<String>, ApiError> {
    sqlx::query_scalar("SELECT symbol FROM assets WHERE lower(symbol) = lower($1)")
        .bind(requested)
        .fetch_optional(pg)
        .await
        .map_err(ApiError::db)
}

/// Fetch the full `AssetCard` for an active asset, looked up by `column`
/// (`"a.symbol"` or `"a.mint"`). `column` is ALWAYS a compile-time literal —
/// never user input — so interpolating it is injection-safe; the looked-up
/// value stays bound as `$1`. Keeps `a.is_active`, so by-mint has the same
/// live-view semantics as by-symbol detail. Mirror of `list`'s
/// intrinsic-snapshot fallback — see its comment for the rationale.
pub(crate) async fn fetch_card(
    pg: &sqlx::PgPool,
    column: &'static str,
    value: &str,
) -> Result<Option<AssetCard>, ApiError> {
    let sql = format!(
        r#"
        SELECT
            a.symbol, a.name, a.mint, a.class::text AS class,
            a.peg_target::text AS peg_target, a.decimals,
            COALESCE(d.state::text, CASE WHEN i.value_usd IS NOT NULL THEN 'UNKNOWN' END) AS state,
            d.discount_smooth AS discount,
            COALESCE(d.intrinsic_usd, i.value_usd) AS intrinsic_usd,
            d.market_usd,
            COALESCE(d.ts, i.ts) AS updated_at,
            s.series_24h,
            i.sol_per_lst,
            d.confidence,
            a.thresholds,
            COALESCE((a.metadata->>'monitoring_only')::boolean, false) AS monitoring_only,
            a.metadata->>'monitoring_reason' AS monitoring_reason,
            a.metadata->>'monitoring_since' AS monitoring_since,
            s.worst_abs_24h,
            s.jitter_bps_24h,
            (d.extra->>'current_state_duration_secs')::bigint AS current_state_duration_secs,
            (d.extra->>'sustained')::boolean AS sustained,
            -- state_reason: use the DB value for fresh rows; synthesize 'stale_source'
            -- when the discount LATERAL (d) returned NULL (feed >15min stale) but we
            -- have intrinsic data — matches what /state returns for the same asset.
            -- Mirrors Rust const STATE_REASON_STALE_SOURCE = "stale_source".
            COALESCE(d.state_reason,
                     CASE WHEN d.state IS NULL AND i.value_usd IS NOT NULL
                          THEN 'stale_source' END) AS state_reason,
            -- Size/context signal (migration 0065) — mirrors ASSETS_LIST_SQL,
            -- see its comment. Populated by the isolated `token_supply`
            -- indexer source, NOT the NAV/discount pipeline.
            a.circulating_supply,
            (a.circulating_supply * d.market_usd) AS market_cap,
            -- Market-context signals (migration 0075) — mirrors ASSETS_LIST_SQL,
            -- see its comment. Populated by the isolated `tokens_xyz_risk`
            -- indexer source, NOT the NAV/discount pipeline.
            m.liquidity_usd, m.volume_24h_usd, m.holder_count,
            m.ts AS market_context_at,
            -- Oracle leg for the advisory, OUT-OF-HASH `oracle_degraded`
            -- annotation (single-asset detail only — see oracle_degraded.rs).
            -- Not selected by ASSETS_LIST_SQL (list has no oracle asof-join),
            -- so `row_to_card`'s `try_get` on a list row misses cleanly.
            o.oracle_usd,
            o.oracle_conf,
            o.oracle_age_secs
        FROM assets a
        LEFT JOIN LATERAL (
            SELECT * FROM discount_snapshots ds
            WHERE ds.asset = a.symbol
              AND ds.ts >= now() - INTERVAL '15 minutes'
            ORDER BY ds.ts DESC LIMIT 1
        ) d ON true
        LEFT JOIN LATERAL (
            SELECT value_usd, ts, (meta->>'sol_per_lst')::numeric AS sol_per_lst FROM intrinsic_snapshots ins
            WHERE ins.asset = a.symbol
            ORDER BY ins.ts DESC LIMIT 1
        ) i ON true
        LEFT JOIN LATERAL (
            -- Mirror of `list`'s s LATERAL — see its comment. Same single
            -- trailing-24h scan yields series_24h + worst_abs_24h (BSRV-02)
            -- + jitter_bps_24h (BSRV-03). Both queries MUST stay in lockstep.
            SELECT array_agg(avg_d ORDER BY hour)::float8[] AS series_24h,
                   max(greatest(abs(hour_min), abs(hour_max))) AS worst_abs_24h,
                   (max(hour_max) - min(hour_min)) AS jitter_bps_24h
            FROM (
                SELECT time_bucket(INTERVAL '1 hour', bucket) AS hour,
                       avg(avg_discount)::float8 AS avg_d,
                       min(min_discount) AS hour_min,
                       max(max_discount) AS hour_max
                FROM discount_1m
                WHERE asset = a.symbol
                  AND bucket >= now() - INTERVAL '24 hours'
                GROUP BY hour
                ORDER BY hour
            ) t
        ) s ON true
        LEFT JOIN LATERAL (
            -- Mirror of `list`'s m LATERAL — see its comment. Both queries MUST
            -- stay in lockstep.
            SELECT liquidity_usd, volume_24h_usd, holder_count, ts
            FROM liquidity_observations lo
            WHERE lo.asset = a.symbol
              AND lo.source = 'tokens_xyz_risk'
            ORDER BY lo.ts DESC LIMIT 1
        ) m ON true
        LEFT JOIN LATERAL (
            -- Mirror of `/history`'s oracle_usd CASE (see its comment for the
            -- feed_id 0x-normalization rationale) — asof-joined to `d.ts`
            -- (the current discount snapshot instant) rather than per-history
            -- row. Same three-part gate: the market must be a DEX source (so
            -- the oracle leg is independent, not a duplicate of a pyth_*
            -- market), the peg target must be USD (the oracle leg is a USD
            -- price), and the asset must actually carry a `pyth_feed_id`.
            -- When `d` is NULL (no fresh discount snapshot — stale/no-data
            -- fallback to intrinsic-only), `os.publish_time <= d.ts` is
            -- NULL and the LATERAL yields no row, so the oracle columns are
            -- NULL too — consistent with "no fresh instant to compare
            -- against" rather than a stale synthesized amber flag.
            SELECT os.price AS oracle_usd,
                   os.confidence AS oracle_conf,
                   extract(epoch from (now() - os.publish_time))::bigint AS oracle_age_secs
            FROM oracle_snapshots os
            WHERE a.market_kind IN ('jupiter_usd', 'dex_screener_usd')
              AND a.peg_target::text = 'USD'
              -- NULLIF, not a plain IS NOT NULL: ~15 DEX-priced USD stables
              -- carry pyth_feed_id='' (empty string = "no oracle feed"), which
              -- passes IS NOT NULL. The asof-join below would then search for
              -- feed_id='' — a value that never exists — and, since that filters
              -- on feed_id (not the PK's `feed`), degenerate into a full
              -- newest→oldest seq-scan of the 90-day oracle_snapshots hypertable
              -- (measured 76-93s on the single-asset detail endpoint). NOTE:
              -- this SQL is built with format!(), so keep braces out of these
              -- comments. Guard on the SAME normalized expression the join key
              -- uses (lower(replace(...,'0x',''))) so a placeholder like '0x'
              -- (which also normalizes to '') is treated as absent too, not
              -- just literal ''. Absent feed => skip the leg (oracle_degraded None).
              AND NULLIF(lower(replace(a.pyth_feed_id, '0x', '')), '') IS NOT NULL
              AND os.feed_id = lower(replace(a.pyth_feed_id, '0x', ''))
              AND os.publish_time <= d.ts
            ORDER BY os.publish_time DESC LIMIT 1
        ) o ON true
        WHERE {column} = $1 AND a.is_active
        "#
    );
    let row = sqlx::query(&sql)
        .bind(value)
        .fetch_optional(pg)
        .await
        .map_err(ApiError::db)?;
    Ok(row.map(row_to_card))
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct HistoryQuery {
    /// `raw` (default) samples directly from `discount_snapshots`; `1m`
    /// reads the 1-minute continuous aggregate so longer ranges stay cheap.
    /// Any other value is rejected with 400 rather than silently falling
    /// back to `raw` (QA B-020).
    #[serde(default = "default_bucket")]
    pub bucket: String,
    /// Inclusive lower bound on `ts`. Defaults to now − 24 hours.
    pub from: Option<DateTime<Utc>>,
    /// Inclusive upper bound on `ts`. Defaults to now.
    pub to: Option<DateTime<Utc>>,
    /// Page size, clamped to `[1, 5000]`. Default `500`.
    #[serde(default = "default_limit")]
    pub limit: i64,
}
fn default_bucket() -> String {
    "raw".into()
}
/// The only `?bucket=` values the history query understands. Anything else
/// used to fall through to the `raw` branch (silent fallback — QA B-020);
/// now it yields a 400 listing these.
const VALID_BUCKETS: [&str; 2] = ["raw", "1m"];
fn default_limit() -> i64 {
    500
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HistoryPoint {
    #[serde(serialize_with = "crate::serde_fmt::ts_millis_z")]
    pub ts: DateTime<Utc>,
    /// EWMA-smoothed discount (the value the state machine uses).
    #[serde(serialize_with = "crate::serde_fmt::dec_norm")]
    pub discount: Decimal,
    /// Raw discount sample (`1 - market/intrinsic`) before EWMA smoothing.
    /// `None` for `bucket=1m` because the continuous aggregate
    /// `discount_1m` only stores `avg(discount_smooth)`. For `bucket=raw`,
    /// populated from `discount_snapshots.discount_raw`.
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_norm"
    )]
    pub discount_raw: Option<Decimal>,
    /// Intrinsic (NAV) leg in USD — the fair-value denominator of the
    /// discount. `None` for `bucket=1m` (the `discount_1m` aggregate stores no
    /// legs); for `bucket=raw`, the `discount_snapshots.intrinsic_usd` column
    /// (`NOT NULL`). Lets the asset-detail "Legs" view distinguish a market
    /// crash from a NAV re-rating — the two legs the single zeroed spread line
    /// structurally cannot separate. USD-denominated, so only meaningful for
    /// USD-peg assets (the client gates the view on `peg_target = USD`).
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_norm"
    )]
    pub intrinsic_usd: Option<Decimal>,
    /// Market leg in USD — the traded price numerator of the discount. Same
    /// `None`-for-1m / present-for-raw semantics as `intrinsic_usd`, from
    /// `discount_snapshots.market_usd` (`NOT NULL`).
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_norm"
    )]
    pub market_usd: Option<Decimal>,
    /// Pyth ORACLE leg in USD — a THIRD, structurally independent price source
    /// (vs the DEX `market_usd` and the NAV `intrinsic_usd`), for the 3-leg
    /// "sources disagree" view. asof-joined from `oracle_snapshots` on the
    /// asset's `pyth_feed_id` (0x-normalized to the indexer's stored form).
    /// `None` for `bucket=1m`. For `bucket=raw`, `None` unless ALL hold: the
    /// market is a DEX source (`market_kind` jupiter_usd/dex_screener_usd, so
    /// the oracle is independent, not a duplicate of a `pyth_*` market), the
    /// asset's `peg_target` is USD (the oracle leg is a USD price — excludes
    /// SOL/BRL/EUR-peg assets like the LSTs, BRZ, EURC whose `<asset>/USD`
    /// feed isn't their peg), the asset carries a `pyth_feed_id`, AND that
    /// feed actually streams into
    /// `oracle_snapshots`. The `market_kind`+`pyth_feed_id` CASE is only a
    /// cheap pre-filter, NOT a subscription proof — `pyth_feed_id` is display
    /// metadata that can name a feed the indexer's `[pyth_feeds]` set never
    /// subscribes; such feeds yield no `oracle_snapshots` rows, so the asof
    /// subquery returns NULL and the leg quietly stays hidden. So the leg
    /// appears only where it's genuinely honest (independent + real data).
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_norm"
    )]
    pub oracle_usd: Option<Decimal>,
    #[schema(value_type = crate::schema::PegState)]
    pub state: String,
}

#[utoipa::path(
    get,
    path = "/v1/assets/{symbol}/history",
    tag = "Assets",
    summary = "Get an asset's discount history",
    params(
        ("symbol" = String, Path, description = "Asset symbol — case-insensitive"),
        HistoryQuery,
    ),
    responses(
        (status = 200, description = "Time series of discount values, newest first", body = crate::response::ApiList<HistoryPoint>),
        (status = 400, description = "Invalid ?bucket= (must be one of raw|1m)", body = ApiError)
    )
)]
pub async fn history(
    State(state): State<Arc<AppState>>,
    Path(symbol): Path<String>,
    ValQuery(q): ValQuery<HistoryQuery>,
) -> Result<Json<crate::response::ApiList<HistoryPoint>>, ApiError> {
    let limit = q.limit.clamp(1, 5000);
    let from = q
        .from
        .unwrap_or_else(|| chrono::Utc::now() - chrono::Duration::hours(24));
    let to = q.to.unwrap_or_else(chrono::Utc::now);

    // Reject unknown ?bucket= values with a structured 400 instead of
    // silently treating them as "raw" (QA B-020).
    if !VALID_BUCKETS.contains(&q.bucket.as_str()) {
        return Err(ApiError::invalid_bucket(&q.bucket, &VALID_BUCKETS));
    }

    // Case-insensitive resolution: map the requested symbol to its canonical
    // catalog casing (no is_active filter — history serves preserved snapshots
    // for soft-deleted assets), then run the exact-case hot-table query with it.
    // An unknown symbol returns an empty series (unchanged), not a 404.
    let symbol = match resolve_symbol(&state.pg, &symbol).await? {
        Some(canonical) => canonical,
        None => return Ok(Json(crate::response::ApiList::new(Vec::new()))),
    };

    // For "raw" we sample directly from discount_snapshots and surface both
    // the smoothed (used by the FSM) and the raw sample (audit / chart
    // overlay); for 1m we use the continuous aggregate which only stores
    // `avg_discount` derived from `discount_smooth` — no raw column.
    let bucket_is_raw = q.bucket.as_str() != "1m";
    let sql = if bucket_is_raw {
        r#"
        SELECT ds.ts, ds.discount_smooth AS discount, ds.discount_raw,
               ds.intrinsic_usd, ds.market_usd, ds.state::text AS state,
               -- 3rd leg: the Pyth oracle price asof-joined at-or-before each
               -- sample, ONLY when the asset's market is a DEX source (so the
               -- oracle is independent, not a duplicate of a pyth_* market) and
               -- an oracle feed is subscribed. Else NULL -> no oracle leg. The
               -- 0067 index (feed_id, publish_time DESC) makes this an index scan.
               CASE
                 WHEN a.market_kind IN ('jupiter_usd', 'dex_screener_usd')
                      AND a.peg_target::text = 'USD'
                      -- NULLIF over the normalized value (matching the join key
                      -- below): pyth_feed_id='' (or a '0x' placeholder) means "no
                      -- oracle feed" but passes a plain IS NOT NULL, and the
                      -- per-row asof subquery would then seq-scan oracle_snapshots
                      -- for feed_id='' (never matches) once per sample — even
                      -- worse than fetch_card's single scan. See fetch_card's o
                      -- LATERAL comment. Absent feed → no oracle leg.
                      AND NULLIF(lower(replace(a.pyth_feed_id, '0x', '')), '') IS NOT NULL
                 THEN (
                   SELECT os.price FROM oracle_snapshots os
                   -- oracle_snapshots.feed_id is stored 0x-stripped + lowercased
                   -- (indexer pyth.rs `trim_start_matches("0x").to_lowercase()`),
                   -- while assets.pyth_feed_id is seeded WITH the 0x prefix — so
                   -- normalize the asset side to match, or exact TEXT equality
                   -- never joins.
                   WHERE os.feed_id = lower(replace(a.pyth_feed_id, '0x', ''))
                     AND os.publish_time <= ds.ts
                   ORDER BY os.publish_time DESC LIMIT 1
                 )
                 ELSE NULL
               END AS oracle_usd
        FROM discount_snapshots ds
        JOIN assets a ON a.symbol = ds.asset
        WHERE ds.asset = $1 AND ds.ts BETWEEN $2 AND $3
        ORDER BY ds.ts DESC LIMIT $4
        "#
    } else {
        r#"
        SELECT bucket AS ts, avg_discount AS discount, end_state::text AS state
        FROM discount_1m
        WHERE asset = $1 AND bucket BETWEEN $2 AND $3
        ORDER BY bucket DESC LIMIT $4
        "#
    };

    let rows = sqlx::query(sql)
        .bind(&symbol)
        .bind(from)
        .bind(to)
        .bind(limit)
        .fetch_all(&state.pg)
        .await
        .map_err(ApiError::db)?;

    let points: Vec<HistoryPoint> = rows
        .into_iter()
        .map(|r| HistoryPoint {
            ts: r.get("ts"),
            discount: r.get("discount"),
            discount_raw: if bucket_is_raw {
                Some(r.get::<Decimal, _>("discount_raw"))
            } else {
                None
            },
            // Legs only exist on the raw table; the 1m aggregate has no
            // intrinsic_usd / market_usd columns, so leave them None there
            // (mirrors discount_raw).
            intrinsic_usd: if bucket_is_raw {
                Some(r.get::<Decimal, _>("intrinsic_usd"))
            } else {
                None
            },
            market_usd: if bucket_is_raw {
                Some(r.get::<Decimal, _>("market_usd"))
            } else {
                None
            },
            // Already nullable in SQL (the CASE returns NULL when the oracle
            // leg isn't honest / no data), so read straight into the Option.
            oracle_usd: if bucket_is_raw {
                r.get::<Option<Decimal>, _>("oracle_usd")
            } else {
                None
            },
            state: r.get("state"),
        })
        .collect();
    Ok(Json(crate::response::ApiList::new(points)))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct StateResp {
    pub asset: String,
    #[schema(value_type = crate::schema::PegState)]
    pub state: String,
    /// Timestamp of the most recent transition into the current state.
    /// Equals the current snapshot timestamp if the engine has only ever
    /// observed one state for this asset.
    #[serde(serialize_with = "crate::serde_fmt::ts_millis_z")]
    pub since: DateTime<Utc>,
    #[serde(serialize_with = "crate::serde_fmt::dec_norm")]
    pub discount: Decimal,
    #[serde(serialize_with = "crate::serde_fmt::dec_norm")]
    pub intrinsic_usd: Decimal,
    #[serde(serialize_with = "crate::serde_fmt::dec_norm")]
    pub market_usd: Decimal,
    /// Timestamp the current snapshot was computed (the latest
    /// `discount_snapshots.ts`). Distinct from `since` (state-transition time):
    /// this is the FRESHNESS signal. The engine stops writing snapshots when a
    /// feed goes stale ("missing data is not confirming data" — H8), so a frozen
    /// `updated_at` is exactly how a stale/frozen feed surfaces on this endpoint.
    #[serde(serialize_with = "crate::serde_fmt::ts_millis_z")]
    pub updated_at: DateTime<Utc>,
    /// `true` when `updated_at` is older than the 15-minute freshness bound the
    /// list/detail endpoints enforce — i.e. the feed has likely frozen. Unlike
    /// list/detail, `/state` still returns the last value rather than 404-hiding
    /// it; read this flag to fail safe. Consumers needing a tighter bound can
    /// derive their own from `updated_at`.
    pub stale: bool,
    /// Advisory machine-readable reason for the current state (mirrors
    /// `discount_snapshots.state_reason` and `Receipt.state_reason`).
    ///
    /// **Emitted today:**
    /// - `premium_sanity` — engine NAV-sanity override: smoothed discount exceeded
    ///   the premium-sanity bound, state forced to UNKNOWN (intrinsic anchor
    ///   suspect).
    /// - `stale_source` — API layer: feed is >15 min stale, state collapsed to
    ///   UNKNOWN; no fresh discount snapshot exists.
    ///
    /// **Reserved — not yet emitted (planned for depth-gate / oracle-crosscheck
    /// work):** `no_oracle_crosscheck | intrinsic_unavailable | shallow_market |
    /// nominal`.
    ///
    /// Omitted when null.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_reason: Option<String>,
    /// Pyth oracle confidence bucket: `high` | `medium` | `low` | `unknown`.
    /// The PRICE-ORACLE confidence-interval signal (conf/price ratio) — the field
    /// integrators should gate automation on alongside `state`. Mirrors the list
    /// endpoint's `confidence`. Collapses to `unknown` when the feed is stale (same
    /// as `state`), so a frozen feed cannot read as confidently pegged. Omitted only
    /// when no snapshot carries a confidence value (non-Pyth-dependent assets).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v1/assets/{symbol}/state",
    tag = "Assets",
    summary = "Get an asset's current peg state",
    params(
        ("symbol" = String, Path, description = "Asset symbol — case-insensitive; resolved to canonical casing")
    ),
    responses(
        (status = 200, description = "Current state + transition timestamp", body = StateResp),
        (status = 404, description = "unknown_asset (symbol not tracked) or no_data (tracked, no snapshot yet)", body = ApiError)
    )
)]
pub async fn state(
    State(state): State<Arc<AppState>>,
    Path(symbol): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let canonical = resolve_symbol(&state.pg, &symbol)
        .await?
        .ok_or_else(|| ApiError::unknown_asset(&symbol))?;
    state_for_symbol(&state.pg, canonical).await
}

#[utoipa::path(
    get,
    path = "/v1/assets/by-mint/{mint}/state",
    tag = "Assets",
    summary = "Get peg state by mint address",
    params(
        ("mint" = String, Path, description = "SPL mint address (base58). Resolved to the asset's symbol, then identical to /v1/assets/{symbol}/state.")
    ),
    responses(
        (status = 200, description = "Current state + transition timestamp", body = StateResp),
        (status = 404, description = "unknown_asset (mint not tracked) or no_data (tracked, no snapshot yet)", body = ApiError)
    )
)]
pub async fn state_by_mint(
    State(state): State<Arc<AppState>>,
    Path(mint): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    // Resolve mint -> symbol WITHOUT an is_active filter: /state serves preserved
    // snapshots for soft-deleted assets, so the by-mint path must behave the same
    // (the by-symbol /state route has no is_active gate either).
    let symbol: Option<String> = sqlx::query_scalar("SELECT symbol FROM assets WHERE mint = $1")
        .bind(&mint)
        .fetch_optional(&state.pg)
        .await
        .map_err(ApiError::db)?;
    let symbol = symbol.ok_or_else(|| ApiError::unknown_asset(&mint))?;
    state_for_symbol(&state.pg, symbol).await
}

async fn state_for_symbol(
    pg: &sqlx::PgPool,
    symbol: String,
) -> Result<impl IntoResponse, ApiError> {
    let row = sqlx::query(
        r#"
        WITH current AS (
            SELECT *,
                   (ts < now() - INTERVAL '15 minutes') AS is_stale
            FROM discount_snapshots
            WHERE asset = $1
            ORDER BY ts DESC LIMIT 1
        ),
        prev AS (
            SELECT max(ts) AS since FROM discount_snapshots
            WHERE asset = $1
              AND state <> (SELECT state FROM current)
        )
        SELECT
          CASE WHEN c.is_stale THEN 'UNKNOWN'
               ELSE c.state::text END AS state,
          CASE WHEN c.is_stale THEN 'stale_source'
               ELSE c.state_reason END AS state_reason,
          -- When stale, `since` must reflect when data stopped (c.ts), not when
          -- the now-collapsed state began — a consumer computing "age of current
          -- UNKNOWN" would otherwise get a too-old, misleading duration.
          CASE WHEN c.is_stale THEN c.ts
               ELSE COALESCE((SELECT since FROM prev), c.ts) END AS since,
          c.discount_smooth AS discount, c.intrinsic_usd, c.market_usd,
          c.ts AS updated_at, c.is_stale AS stale,
          -- Collapse confidence to 'unknown' on a stale feed, mirroring the state
          -- collapse above — a frozen feed must not read as confidently pegged.
          CASE WHEN c.is_stale THEN 'unknown'
               ELSE c.confidence END AS confidence
        FROM current c
        "#,
    )
    .bind(&symbol)
    .fetch_optional(pg)
    .await
    .map_err(ApiError::db)?;
    let row = match row {
        Some(r) => r,
        None => {
            // No snapshot for this symbol. Split unknown_asset (never in the
            // registry) from no_data (tracked, but no snapshot yet) — the old
            // shared "no snapshots for X" conflated them. state() has NO
            // is_active gate (it serves preserved snapshots for soft-deleted
            // assets like pbUSDC/dSOL), so the existence probe MUST omit
            // is_active too, else those would mis-classify as unknown_asset.
            let exists: bool =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM assets WHERE symbol = $1)")
                    .bind(&symbol)
                    .fetch_one(pg)
                    .await
                    .map_err(ApiError::db)?;
            return Err(if exists {
                ApiError::no_data(symbol)
            } else {
                ApiError::unknown_asset(symbol)
            });
        }
    };

    // Tighter cache than detail (max-age=3): state() has no 15-min freshness
    // bound, so we keep the window short. 404s stay uncached (Ok path only).
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3, stale-while-revalidate=10"),
    );
    Ok((
        headers,
        Json(StateResp {
            asset: symbol,
            state: row.get("state"),
            since: row.get("since"),
            discount: row.get("discount"),
            intrinsic_usd: row.get("intrinsic_usd"),
            market_usd: row.get("market_usd"),
            updated_at: row.get("updated_at"),
            stale: row.get("stale"),
            state_reason: row.try_get("state_reason").ok(),
            confidence: row.try_get("confidence").ok(),
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;
    use serde_json::json;

    /// A baseline `AssetCard` with every additive Option field set to `None`.
    /// Mirrors the intrinsic-only fallback row a non-LST, no-recent-discount
    /// asset would produce.
    /// The two invariants ported from `withStaleFallback`. Both are about what
    /// must NOT be remembered, which is the part that is easy to get wrong.
    #[test]
    fn last_known_good_never_remembers_an_empty_catalogue() {
        // A successful query returning zero rows is a broken query, not an
        // empty universe — caching it would turn one bad read into a
        // long-lived wrong answer served during the next outage.
        assert!(
            !assets_list_is_healthy(&[]),
            "an empty assets list must never become last-known-good"
        );
        assert!(assets_list_is_healthy(&[empty_card()]));
    }

    /// The degraded response must report WHEN the data was true, not when it
    /// was served. Reporting `now` would be a freshness claim we cannot make.
    #[test]
    fn stale_payload_keeps_its_original_generated_at() {
        let original = "2026-08-10T11:00:00.000Z".to_string();
        let stored = StoredLastGood {
            generated_at: original.clone(),
            cards: vec![empty_card()],
        };
        let round_tripped: StoredLastGood =
            serde_json::from_str(&serde_json::to_string(&stored).unwrap()).unwrap();
        let body = crate::response::ApiList::with_generated_at(
            round_tripped.cards,
            round_tripped.generated_at,
        );
        let v = serde_json::to_value(&body).unwrap();
        assert_eq!(v["generated_at"], original);
        assert_eq!(v["ok"], true);
        assert_eq!(v["count"], 1);
    }

    /// The two cache keys must stay distinct: one is a 5s latency cache whose
    /// miss is normal, the other is a 24h degradation payload read only when
    /// Postgres fails. Collapsing them would make every cache miss serve stale.
    #[test]
    fn cache_keys_are_distinct() {
        assert_ne!(ASSETS_LIST_CACHE_KEY, ASSETS_LIST_LAST_GOOD_KEY);
        // The TTL relationship is between two consts, so it belongs at compile
        // time — a runtime `assert!` over consts folds to `assert!(true)` and
        // checks nothing. This fails the BUILD if the two TTLs ever converge.
        const _: () = assert!(
            ASSETS_LIST_LAST_GOOD_TTL_SECS > ASSETS_LIST_CACHE_TTL_SECS * 100,
            "last-known-good must outlive the latency cache by orders of magnitude"
        );
    }

    fn empty_card() -> AssetCard {
        let anchor = crate::schema::anchor_for_class("stable_fiat");
        AssetCard {
            symbol: "USDC".into(),
            name: "USD Coin".into(),
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".into(),
            class: "stable_fiat".into(),
            risk_side: crate::schema::risk_side_for_anchor(anchor).into(),
            anchor: anchor.into(),
            peg_target: "USD".into(),
            decimals: 6,
            state: None,
            discount: None,
            risk_score: None,
            intrinsic_usd: None,
            market_usd: None,
            updated_at: None,
            series_24h: None,
            sol_per_lst: None,
            confidence: None,
            thresholds: None,
            monitoring_only: false,
            monitoring_reason: None,
            monitoring_since: None,
            calibration: crate::schema::calibration_label(false).into(),
            worst_abs_24h: None,
            jitter_bps_24h: None,
            current_state_duration_secs: None,
            sustained: None,
            state_reason: None,
            circulating_supply: None,
            market_cap: None,
            liquidity_usd: None,
            volume_24h_usd: None,
            holder_count: None,
            market_context_at: None,
            market_depth: None,
            oracle_degraded: None,
        }
    }

    /// End-to-end serialization on the REAL `AssetCard` (the `/v1/assets` +
    /// cache shape): noisy DB-scale decimals, raw-float sparkline, and a µs+offset
    /// timestamp must all come out clean on the wire, values preserved.
    #[test]
    fn asset_card_serializes_clean_decimals_series_and_timestamp() {
        use std::str::FromStr;
        let mut c = empty_card();
        c.discount = Some(Decimal::from_str("-0.011208").unwrap());
        c.intrinsic_usd = Some(Decimal::from_str("82.379387149534329810").unwrap());
        c.market_usd = Some(Decimal::from_str("83.215617875255630000").unwrap());
        c.sol_per_lst = Some(Decimal::from_str("1.110411409").unwrap());
        c.circulating_supply = Some(Decimal::from_str("9079403.708996305").unwrap());
        c.market_cap = Some(Decimal::from_str("755548189.58301518463708260045").unwrap());
        c.updated_at = Some("2026-07-24T15:33:15.996734+00:00".parse().unwrap());
        c.series_24h = Some(vec![-0.011128676923076923, -0.0111448175]);

        let v = serde_json::to_value(&c).unwrap();
        // Prices/ratios: trailing-zero noise stripped, value identical.
        assert_eq!(v["intrinsic_usd"], "82.37938714953432981");
        assert_eq!(v["market_usd"], "83.21561787525563");
        assert_eq!(v["discount"], "-0.011208");
        assert_eq!(v["sol_per_lst"], "1.110411409");
        assert_eq!(v["circulating_supply"], "9079403.708996305");
        // USD aggregate: rounded to the cent (was 20-scale noise before).
        assert_eq!(v["market_cap"], "755548189.58");
        // Sparkline: raw-float noise rounded to 8dp (ryu shortest form).
        assert_eq!(v["series_24h"], json!([-0.01112868, -0.01114482]));
        // Timestamp: canonical millisecond-Z (µs+offset before).
        assert_eq!(v["updated_at"], "2026-07-24T15:33:15.996Z");
    }

    /// Sub-C systemic summary (feed): omitted when there's no real leverage,
    /// present with a full cascade when there is. Pure — no DB.
    #[test]
    fn build_systemic_omits_no_leverage_and_carries_cascade() {
        let ts = "2026-07-24T12:00:00Z".parse::<DateTime<Utc>>().unwrap();

        // No exposure rows at all → omitted.
        assert!(build_systemic(&[], &[]).is_none());

        // Exposure present but zero leverage → not a systemic exposure → omitted.
        let zero = vec![(
            "kamino".to_string(),
            Some(Decimal::ZERO),
            "full".to_string(),
            ts,
        )];
        assert!(build_systemic(&zero, &[]).is_none());

        // Real leverage + a risky (1.0-1.05, mid HF 1.025) band → present, with a
        // rung per preset shock. The band liquidates once 1.025·(1−s) < 1, i.e.
        // s > ~2.44%: not at 100 bps, yes from 250 bps up.
        let exp = vec![(
            "kamino".to_string(),
            Some(Decimal::from(1_000_000)),
            "full".to_string(),
            ts,
        )];
        let bands = vec![HfBandRow {
            protocol: "kamino".to_string(),
            hf_band: "1.0-1.05".to_string(),
            collateral_usd: Decimal::from(500_000),
            position_bucket: ">50".to_string(),
            ts,
        }];
        let sig = build_systemic(&exp, &bands).expect("has leverage");
        assert_eq!(sig.loop_exposure_usd, Decimal::from(1_000_000));
        assert_eq!(sig.protocols, vec!["kamino".to_string()]);
        assert_eq!(sig.cascade.len(), SHOCK_BPS_GRID.len());
        // k-suppressed cascade → never overclaims full coverage (honest floor,
        // consistent with simulate_depeg).
        assert_eq!(sig.coverage, "partial");
        let at = |bps: i32| {
            sig.cascade
                .iter()
                .find(|r| r.shock_bps == bps)
                .unwrap()
                .liquidatable_usd
        };
        assert_eq!(at(100), Decimal::ZERO);
        assert_eq!(at(250), Decimal::from(500_000));
        assert_eq!(at(2000), Decimal::from(500_000));

        // The systemic block is serialized under its own key (not mixed into peg
        // fields), carrying the advisory note.
        assert!(sig.advisory_note.contains("advisory"));
    }

    /// BSRV-01/02/03: when all three new fields are `None`, the serialized JSON
    /// OMITS the keys entirely (skip_serializing_if = Option::is_none) so
    /// existing clients see a byte-identical shape — `null` would be a contract
    /// change. Also re-asserts the pre-existing optional fields stay omitted.
    #[test]
    fn new_fields_omitted_when_none() {
        let v = serde_json::to_value(empty_card()).expect("serialize");
        let obj = v.as_object().expect("card is a JSON object");

        for key in [
            "thresholds",
            "worst_abs_24h",
            "jitter_bps_24h",
            // pre-existing skip-if-none fields — guard against regression.
            "series_24h",
            "sol_per_lst",
            "confidence",
            "state_reason",
            "oracle_degraded",
        ] {
            assert!(
                !obj.contains_key(key),
                "key `{key}` must be OMITTED (not null) when None; got {v}"
            );
        }

        // circulating_supply / market_cap (migration 0065) serialize as `null`
        // when None (like `discount`) — present-but-null, NOT omitted.
        for key in ["circulating_supply", "market_cap"] {
            assert!(
                obj.contains_key(key) && obj[key].is_null(),
                "key `{key}` must be present-and-null when None; got {v}"
            );
        }

        // The non-optional contract the web client always deserializes stays.
        for key in [
            "symbol",
            "name",
            "mint",
            "class",
            "anchor",
            "risk_side",
            "peg_target",
            "decimals",
        ] {
            assert!(obj.contains_key(key), "required key `{key}` missing: {v}");
        }
        // `anchor` is always present and must be "USD" for stable_fiat.
        assert_eq!(
            obj.get("anchor").and_then(|x| x.as_str()),
            Some("USD"),
            "stable_fiat anchor must be USD"
        );
        // `risk_side` is always present and must be "below" for USD anchors.
        assert_eq!(
            obj.get("risk_side").and_then(|x| x.as_str()),
            Some("below"),
            "stable_fiat risk_side must be below"
        );
        assert_eq!(
            obj.get("monitoring_only").and_then(|x| x.as_bool()),
            Some(false)
        );
        // `calibration` is always present (never skip-if-none) and reads
        // `calibrated` for a non-monitoring_only asset.
        assert_eq!(
            obj.get("calibration").and_then(|x| x.as_str()),
            Some("calibrated")
        );
    }

    /// BSRV-01/02/03: when present, the three new fields serialize under their
    /// documented keys — `thresholds` as the verbatim JSONB object,
    /// `worst_abs_24h` / `jitter_bps_24h` as rust_decimal string-decimals.
    #[test]
    fn new_fields_present_when_set() {
        let mut card = empty_card();
        card.thresholds = Some(json!({
            "drift_bps": 45, "depeg_bps": 110, "critical_bps": 250
        }));
        card.monitoring_only = true;
        card.monitoring_reason = Some("Calibration v1 downgrade".into());
        card.monitoring_since = Some("2026-06-10".into());
        card.calibration = crate::schema::calibration_label(true).into();
        card.worst_abs_24h = Some(Decimal::new(123, 4)); // 0.0123
        card.jitter_bps_24h = Some(Decimal::new(456, 4)); // 0.0456

        let v = serde_json::to_value(&card).expect("serialize");
        let obj = v.as_object().expect("card is a JSON object");

        // thresholds passes through verbatim as a nested object (BSRV-01).
        let th = obj.get("thresholds").expect("thresholds present");
        assert_eq!(th.get("drift_bps").and_then(|x| x.as_i64()), Some(45));
        assert_eq!(th.get("depeg_bps").and_then(|x| x.as_i64()), Some(110));
        assert_eq!(th.get("critical_bps").and_then(|x| x.as_i64()), Some(250));
        assert_eq!(
            obj.get("monitoring_only").and_then(|x| x.as_bool()),
            Some(true)
        );
        assert_eq!(
            obj.get("monitoring_reason").and_then(|x| x.as_str()),
            Some("Calibration v1 downgrade")
        );
        assert_eq!(
            obj.get("monitoring_since").and_then(|x| x.as_str()),
            Some("2026-06-10")
        );
        assert_eq!(
            obj.get("calibration").and_then(|x| x.as_str()),
            Some("provisional")
        );

        // CDP cr_* shape also passes through unchanged.
        card.thresholds = Some(json!({
            "cr_drift": 130, "cr_depeg": 115, "cr_critical": 105, "cr_black_swan": 100
        }));
        let v2 = serde_json::to_value(&card).expect("serialize");
        let th2 = v2.get("thresholds").expect("thresholds present");
        assert_eq!(th2.get("cr_drift").and_then(|x| x.as_i64()), Some(130));
        assert_eq!(th2.get("cr_black_swan").and_then(|x| x.as_i64()), Some(100));

        // Decimal fields serialize as JSON strings (rust_decimal serde feature),
        // matching `discount`/`intrinsic_usd`/`market_usd`. Deserialize back to
        // confirm they round-trip (BSRV-02/03 "deserialize when present").
        let worst = obj
            .get("worst_abs_24h")
            .and_then(|x| x.as_str())
            .expect("worst_abs_24h as string");
        assert_eq!(worst.parse::<Decimal>().unwrap(), Decimal::new(123, 4));
        let jitter = obj
            .get("jitter_bps_24h")
            .and_then(|x| x.as_str())
            .expect("jitter_bps_24h as string");
        assert_eq!(jitter.parse::<Decimal>().unwrap(), Decimal::new(456, 4));
    }

    /// Migration 0065 size/context signal: `circulating_supply` and
    /// `market_cap` serialize as rust_decimal string-decimals when present
    /// (same shape as `discount`/`worst_abs_24h`/etc.), and `market_cap` is
    /// the exact `circulating_supply × market_usd` product — mirroring the
    /// `a.circulating_supply * d.market_usd` computed column in
    /// `ASSETS_LIST_SQL` / `fetch_card`'s SQL.
    #[test]
    fn market_cap_equals_circulating_supply_times_market_usd() {
        let mut card = empty_card();
        let supply = Decimal::new(5_000_000, 0); // 5,000,000 tokens
        let price = Decimal::new(102345, 5); // $1.02345
        card.circulating_supply = Some(supply);
        card.market_usd = Some(price);
        card.market_cap = Some(supply * price);

        let v = serde_json::to_value(&card).expect("serialize");
        let obj = v.as_object().expect("card is a JSON object");

        let supply_str = obj
            .get("circulating_supply")
            .and_then(|x| x.as_str())
            .expect("circulating_supply as string");
        assert_eq!(supply_str.parse::<Decimal>().unwrap(), supply);

        let cap_str = obj
            .get("market_cap")
            .and_then(|x| x.as_str())
            .expect("market_cap as string");
        let cap: Decimal = cap_str.parse().unwrap();
        // 5,000,000 * 1.02345 = 5,117,250 exactly.
        assert_eq!(cap, Decimal::new(5_117_250, 0), "5,000,000 * 1.02345");
        assert_eq!(cap, supply * price, "market_cap must equal supply × price");
    }

    /// `market_cap` must be `null` (present-but-null, like `discount`) whenever
    /// either factor is missing — mirrors the SQL's NULL-propagation through the
    /// `a.circulating_supply * d.market_usd` multiplication (no market
    /// snapshot yet, or the mint hasn't been observed by `token_supply`).
    #[test]
    fn market_cap_null_when_either_factor_missing() {
        let mut no_supply = empty_card();
        no_supply.market_usd = Some(Decimal::new(1, 0));
        no_supply.market_cap = None; // circulating_supply is None -> SQL NULL
        let v = serde_json::to_value(&no_supply).unwrap();
        assert!(v["market_cap"].is_null());

        let mut no_price = empty_card();
        no_price.circulating_supply = Some(Decimal::new(1_000, 0));
        no_price.market_cap = None; // market_usd is None -> SQL NULL
        let v2 = serde_json::to_value(&no_price).unwrap();
        assert!(v2["market_cap"].is_null());
    }

    #[test]
    fn persistence_fields_omitted_when_none_present_when_set() {
        // None → omitted (not null).
        let mut c = empty_card();
        c.current_state_duration_secs = None;
        c.sustained = None;
        let v = serde_json::to_value(&c).unwrap();
        assert!(v.get("current_state_duration_secs").is_none());
        assert!(v.get("sustained").is_none());
        // Some → present.
        c.current_state_duration_secs = Some(7_776_000); // ~90 days
        c.sustained = Some(true);
        let v = serde_json::to_value(&c).unwrap();
        assert_eq!(v["current_state_duration_secs"], 7_776_000);
        assert_eq!(v["sustained"], true);
    }

    /// Wiring check (not the pure classifier — see `oracle_degraded.rs`'s own
    /// `#[cfg(test)]` module for that): `AssetCard.oracle_degraded` nests the
    /// full `OracleDegraded` object under its key when `Some`, and is omitted
    /// (not `null`) when `None` — the same additive contract as
    /// `thresholds`/`worst_abs_24h`/etc., re-asserted here for the nested-
    /// struct case specifically.
    #[test]
    fn oracle_degraded_nests_when_present_omitted_when_none() {
        let mut c = empty_card();
        assert!(serde_json::to_value(&c)
            .unwrap()
            .get("oracle_degraded")
            .is_none());

        c.oracle_degraded = Some(OracleDegraded {
            reason: "oracle_divergence".into(),
            spread_bps: Some(200),
            conf_bps: Some(150),
            age_secs: Some(30),
        });
        let v = serde_json::to_value(&c).unwrap();
        let og = v.get("oracle_degraded").expect("oracle_degraded present");
        assert_eq!(og["reason"], "oracle_divergence");
        assert_eq!(og["spread_bps"], 200);
        assert_eq!(og["conf_bps"], 150);
        assert_eq!(og["age_secs"], 30);
    }

    /// P3: `/state`'s `StateResp` gains `updated_at` + `stale` — the freshness
    /// signal the 2026-06-08 Jupiter staleness incident proved was missing. The
    /// change is ADDITIVE: the six legacy keys keep their names + presence, and
    /// the two new keys serialize as an RFC3339 string and a JSON bool. Locks
    /// the contract embed.js + the marketing embed depend on (they read only
    /// state/peg_state/discount and ignore unknown keys).
    #[test]
    fn state_resp_additive_freshness_fields() {
        let resp = StateResp {
            asset: "jitoSOL".into(),
            state: "PEGGED".into(),
            since: DateTime::parse_from_rfc3339("2026-06-02T00:36:46Z")
                .unwrap()
                .with_timezone(&Utc),
            discount: Decimal::new(-5163, 6),
            intrinsic_usd: Decimal::new(839096, 4),
            market_usd: Decimal::new(844091, 4),
            updated_at: DateTime::parse_from_rfc3339("2026-06-08T01:24:19Z")
                .unwrap()
                .with_timezone(&Utc),
            stale: true,
            state_reason: None,
            confidence: Some("unknown".into()),
        };
        let v = serde_json::to_value(&resp).expect("serialize");
        let obj = v.as_object().expect("state resp is a JSON object");
        // The gating field integrators check must be present + collapse-aware.
        assert_eq!(
            obj.get("confidence").and_then(|x| x.as_str()),
            Some("unknown")
        );

        // Six legacy keys unchanged (name + presence) — the additive contract.
        for key in [
            "asset",
            "state",
            "since",
            "discount",
            "intrinsic_usd",
            "market_usd",
        ] {
            assert!(obj.contains_key(key), "legacy key `{key}` missing: {v}");
        }
        // New freshness fields: updated_at is an RFC3339 string, stale is a bool.
        assert!(
            obj.get("updated_at").and_then(|x| x.as_str()).is_some(),
            "updated_at must be an RFC3339 string: {v}"
        );
        assert_eq!(obj.get("stale").and_then(|x| x.as_bool()), Some(true));
    }

    /// anchor field: always present and serialized as "USD", "FX", or "NAV".
    /// Covers every class in the asset_class Postgres enum (migration 0001 +
    /// 0003) plus the unknown-class fallback.
    #[test]
    fn anchor_for_class_covers_all_classes() {
        use crate::schema::anchor_for_class;

        // USD-anchored classes — fixed $1 target.
        assert_eq!(anchor_for_class("stable_fiat"), "USD", "stable_fiat");
        assert_eq!(anchor_for_class("stable_cdp"), "USD", "stable_cdp");
        assert_eq!(anchor_for_class("stable_rwa"), "USD", "stable_rwa");
        assert_eq!(anchor_for_class("stable_dn"), "USD", "stable_dn");

        // FX-anchored class — fixed non-USD fiat peg (EURC→EUR, BRZ→BRL).
        // C2: stable_fx must be "FX", NOT "USD" — the consumer reads
        // `peg_target` (EUR / BRL) to learn WHICH currency.
        assert_eq!(anchor_for_class("stable_fx"), "FX", "stable_fx");

        // NAV-anchored classes — intrinsic redemption/net-asset value.
        assert_eq!(anchor_for_class("lst"), "NAV", "lst");
        assert_eq!(anchor_for_class("stable_yield"), "NAV", "stable_yield");
        assert_eq!(anchor_for_class("synth_lev"), "NAV", "synth_lev");

        // Unknown/unrecognised class defaults conservatively to "NAV"
        // (don't assume a fixed rate for an unknown class).
        assert_eq!(
            anchor_for_class("unknown_future_class"),
            "NAV",
            "unknown fallback"
        );
        assert_eq!(anchor_for_class(""), "NAV", "empty string fallback");
    }

    /// anchor field serializes correctly on AssetCard for all three anchors.
    #[test]
    fn asset_card_anchor_serializes() {
        // USD anchor — stable_fiat (USDC baseline).
        let card = empty_card();
        let v = serde_json::to_value(&card).expect("serialize");
        assert_eq!(
            v.get("anchor").and_then(|x| x.as_str()),
            Some("USD"),
            "stable_fiat card must have anchor=USD"
        );

        // FX anchor — stable_fx (EURC/BRZ).
        // C2: stable_fx now emits "FX" so consumers know to read `peg_target`
        // for the non-USD currency rather than assuming a $1 target.
        let mut fx_card = empty_card();
        fx_card.class = "stable_fx".into();
        fx_card.anchor = crate::schema::anchor_for_class("stable_fx").into();
        fx_card.peg_target = "EUR".into();
        let v_fx = serde_json::to_value(&fx_card).expect("serialize fx card");
        assert_eq!(
            v_fx.get("anchor").and_then(|x| x.as_str()),
            Some("FX"),
            "stable_fx card must have anchor=FX"
        );

        // NAV anchor — lst.
        let mut lst_card = empty_card();
        lst_card.class = "lst".into();
        lst_card.anchor = crate::schema::anchor_for_class("lst").into();
        lst_card.peg_target = "SOL".into();
        let v2 = serde_json::to_value(&lst_card).expect("serialize lst card");
        assert_eq!(
            v2.get("anchor").and_then(|x| x.as_str()),
            Some("NAV"),
            "lst card must have anchor=NAV"
        );

        // NAV anchor — stable_yield.
        let mut yield_card = empty_card();
        yield_card.class = "stable_yield".into();
        yield_card.anchor = crate::schema::anchor_for_class("stable_yield").into();
        let v3 = serde_json::to_value(&yield_card).expect("serialize yield card");
        assert_eq!(
            v3.get("anchor").and_then(|x| x.as_str()),
            Some("NAV"),
            "stable_yield card must have anchor=NAV"
        );
    }

    /// risk_side helper: "NAV" → "either", everything else → "below".
    /// Also locks the mapping for unknown/future anchors (conservative default).
    #[test]
    fn risk_side_for_anchor_mapping() {
        use crate::schema::risk_side_for_anchor;
        assert_eq!(risk_side_for_anchor("NAV"), "either", "NAV anchor");
        assert_eq!(risk_side_for_anchor("USD"), "below", "USD anchor");
        assert_eq!(risk_side_for_anchor("FX"), "below", "FX anchor");
        // Unknown anchor — conservative "below" (don't assume premium is safe).
        assert_eq!(
            risk_side_for_anchor("UNKNOWN_FUTURE"),
            "below",
            "unknown anchor fallback"
        );
    }

    /// risk_side is always present on AssetCard and serializes correctly.
    /// - USD anchor (stable_fiat) → "below"
    /// - FX anchor (stable_fx)   → "below"
    /// - NAV anchor (lst)        → "either"
    #[test]
    fn asset_card_risk_side_serializes() {
        // USD anchor (the baseline empty_card is stable_fiat / USD).
        let usd_card = empty_card();
        let v = serde_json::to_value(&usd_card).expect("serialize");
        assert_eq!(
            v.get("risk_side").and_then(|x| x.as_str()),
            Some("below"),
            "USD anchor must serialize risk_side=below"
        );

        // FX anchor — stable_fx.
        let mut fx_card = empty_card();
        fx_card.class = "stable_fx".into();
        fx_card.anchor = crate::schema::anchor_for_class("stable_fx").into();
        fx_card.risk_side = crate::schema::risk_side_for_anchor(&fx_card.anchor).into();
        fx_card.peg_target = "EUR".into();
        let v_fx = serde_json::to_value(&fx_card).expect("serialize fx card");
        assert_eq!(
            v_fx.get("risk_side").and_then(|x| x.as_str()),
            Some("below"),
            "FX anchor must serialize risk_side=below"
        );

        // NAV anchor — lst.
        let mut lst_card = empty_card();
        lst_card.class = "lst".into();
        lst_card.anchor = crate::schema::anchor_for_class("lst").into();
        lst_card.risk_side = crate::schema::risk_side_for_anchor(&lst_card.anchor).into();
        lst_card.peg_target = "SOL".into();
        let v_lst = serde_json::to_value(&lst_card).expect("serialize lst card");
        assert_eq!(
            v_lst.get("risk_side").and_then(|x| x.as_str()),
            Some("either"),
            "NAV anchor must serialize risk_side=either"
        );

        // NAV anchor — stable_yield.
        let mut yield_card = empty_card();
        yield_card.class = "stable_yield".into();
        yield_card.anchor = crate::schema::anchor_for_class("stable_yield").into();
        yield_card.risk_side = crate::schema::risk_side_for_anchor(&yield_card.anchor).into();
        let v_yield = serde_json::to_value(&yield_card).expect("serialize yield card");
        assert_eq!(
            v_yield.get("risk_side").and_then(|x| x.as_str()),
            Some("either"),
            "NAV anchor (stable_yield) must serialize risk_side=either"
        );
    }

    /// P2: the new static `by-mint` segment must coexist with the `:symbol`
    /// wildcard at the same router depth. axum 0.7 (matchit 0.7) inserts routes
    /// eagerly and PANICS on a conflict, so simply BUILDING the Router is the
    /// assertion — the tree had no prior static-vs-param sibling, so this guards
    /// against a regression that would only otherwise surface at server boot.
    #[test]
    fn by_mint_routes_do_not_conflict_with_symbol_wildcard() {
        use axum::routing::get;
        use axum::Router;
        let _app: Router<std::sync::Arc<crate::AppState>> = Router::new()
            .route("/v1/assets/:symbol", get(detail))
            .route("/v1/assets/:symbol/history", get(history))
            .route("/v1/assets/:symbol/state", get(state))
            .route("/v1/assets/by-mint/:mint", get(detail_by_mint))
            .route("/v1/assets/by-mint/:mint/state", get(state_by_mint));
    }

    fn legs_point(intrinsic: Option<Decimal>, market: Option<Decimal>) -> HistoryPoint {
        HistoryPoint {
            ts: DateTime::parse_from_rfc3339("2026-06-13T00:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            discount: Decimal::new(40, 4), // 0.0040
            discount_raw: market.map(|_| Decimal::new(38, 4)),
            intrinsic_usd: intrinsic,
            market_usd: market,
            oracle_usd: None,
            state: "PEGGED".into(),
        }
    }

    /// Asset-detail "Legs" mode: the raw USD price legs `intrinsic_usd` /
    /// `market_usd` are ADDITIVE on `HistoryPoint`. For `bucket=1m` the
    /// continuous aggregate stores no legs, so both are `None` and MUST be
    /// OMITTED (skip_serializing_if) — `null` would be a contract change.
    /// Mirrors the pre-existing `discount_raw` optional pattern so a 1m
    /// response stays byte-identical for existing clients.
    #[test]
    fn history_point_legs_omitted_when_none() {
        let v = serde_json::to_value(legs_point(None, None)).expect("serialize");
        let obj = v.as_object().expect("history point is a JSON object");
        for key in ["discount_raw", "intrinsic_usd", "market_usd", "oracle_usd"] {
            assert!(
                !obj.contains_key(key),
                "key `{key}` must be OMITTED (not null) when None; got {v}"
            );
        }
        // The non-optional contract the web client always deserializes stays.
        for key in ["ts", "discount", "state"] {
            assert!(obj.contains_key(key), "required key `{key}` missing: {v}");
        }
    }

    /// For `bucket=raw` the legs come straight from `discount_snapshots`
    /// (`intrinsic_usd` / `market_usd`, both `NOT NULL`) and serialize as
    /// rust_decimal string-decimals — the same shape as `discount` so the web
    /// client parses them identically.
    #[test]
    fn history_point_legs_present_when_set() {
        let v = serde_json::to_value(legs_point(
            Some(Decimal::new(10000, 4)), // 1.0000
            Some(Decimal::new(9996, 4)),  // 0.9996
        ))
        .expect("serialize");
        let obj = v.as_object().expect("history point is a JSON object");

        let intrinsic = obj
            .get("intrinsic_usd")
            .and_then(|x| x.as_str())
            .expect("intrinsic_usd as string");
        assert_eq!(
            intrinsic.parse::<Decimal>().unwrap(),
            Decimal::new(10000, 4)
        );
        let market = obj
            .get("market_usd")
            .and_then(|x| x.as_str())
            .expect("market_usd as string");
        assert_eq!(market.parse::<Decimal>().unwrap(), Decimal::new(9996, 4));
    }

    /// The 3-leg oracle leg serializes as a decimal string when present (the
    /// asof-joined Pyth price), and is OMITTED (covered above) when the SQL
    /// CASE returns NULL — i.e. the market is itself a Pyth feed or no oracle
    /// is subscribed, so the leg only ever appears where it's honest.
    #[test]
    fn history_point_oracle_leg_present_when_set() {
        let mut p = legs_point(Some(Decimal::new(10000, 4)), Some(Decimal::new(9996, 4)));
        p.oracle_usd = Some(Decimal::new(9990, 4)); // 0.9990
        let v = serde_json::to_value(&p).expect("serialize");
        let oracle = v
            .as_object()
            .unwrap()
            .get("oracle_usd")
            .and_then(|x| x.as_str())
            .expect("oracle_usd as string");
        assert_eq!(oracle.parse::<Decimal>().unwrap(), Decimal::new(9990, 4));
    }
}
