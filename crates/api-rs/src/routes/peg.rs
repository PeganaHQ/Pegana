//! `/v1/peg/feed` — Pegana's peg signal as a per-asset array for tokens.xyz.
//!
//! A read-only transform of the existing `/v1/assets` data (`AssetCard`) into a
//! purpose-built, versioned contract: a `data` array of per-asset signals, each
//! carrying its own Solana `mint`. No new SQL, no migration, no methodology
//! impact. The Foundation's tokens.xyz product indexes `data[]` by each signal's
//! `mint` into its own per-currency buckets; `tokens_variant` is THEIRS and is
//! not emitted here. Contract: docs/superpowers/specs/2026-06-24-01-*.md.

use crate::error::ApiError;
use crate::routes::assets::{
    fetch_assets_list, fetch_card, systemic_signal_for, systemic_signal_map, AssetCard,
    SystemicSignal, ASSETS_LIST_CACHE_KEY, ASSETS_LIST_CACHE_TTL_SECS,
};
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use utoipa::ToSchema;

/// 15-minute current-snapshot freshness bound. Matches the `state()` endpoint's
/// stale definition (`ts < now() - INTERVAL '15 minutes'`) and `ASSETS_LIST_SQL`'s
/// discount LATERAL window, so `stale` here means exactly what the rest of the API
/// means by it.
const FRESHNESS_MINUTES: i64 = 15;

/// One asset's peg signal. A superset of the tokens.xyz contract subset; every
/// `Option` field is omitted (not null) when absent so a thin consumer can model
/// only what it needs.
#[derive(Debug, Serialize, ToSchema)]
pub struct PegSignal {
    /// Canonical Solana mint; the join key each signal carries in the batch
    /// `data[]` array (index the array by this).
    pub mint: String,
    pub symbol: String,
    pub name: String,
    pub class: String,
    /// USD | FX | NAV; how to read fair value without Pegana's taxonomy.
    #[schema(value_type = crate::schema::Anchor)]
    pub anchor: String,
    pub peg_target: String,
    pub decimals: i16,
    /// PEGGED..BLACK_SWAN | UNKNOWN. Always present: UNKNOWN (state_reason
    /// stale_source on `/v1/assets`; `stale: true` here) when there is no
    /// fresh snapshot.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::schema::PegState>)]
    pub state: Option<String>,
    /// Signed discount fraction (serialized as a string): the smoothed value
    /// the state machine classifies, in SOL terms for LSTs. Do not recompute it
    /// from `intrinsic_usd` / `market_usd`; the USD legs use separate SOL/USD
    /// reads and can differ by a few bps, near zero even in sign.
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_norm"
    )]
    pub discount: Option<Decimal>,
    /// Unsmoothed discount for the same tick (before the EWMA), same basis as
    /// `discount`. Omitted when there is no fresh snapshot. `discount` (and
    /// `state`) remain the values to act on; see `AssetCard.discount_raw`.
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_norm"
    )]
    pub discount_raw: Option<Decimal>,
    /// Convenience `discount × 10000` in basis points, a JSON number rounded
    /// to 4 dp. The only ratio field serialized as a number, not a string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discount_bps: Option<f64>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_norm"
    )]
    pub intrinsic_usd: Option<Decimal>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_norm"
    )]
    pub market_usd: Option<Decimal>,
    /// Pyth confidence bucket: high | medium | low | unknown. Omitted when no snapshot.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::schema::Confidence>)]
    pub confidence: Option<String>,
    /// provisional | calibrated. Always present.
    #[schema(value_type = crate::schema::Calibration)]
    pub calibration: String,
    pub monitoring_only: bool,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_norm"
    )]
    pub worst_abs_24h: Option<Decimal>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_norm"
    )]
    pub jitter_bps_24h: Option<Decimal>,
    /// Composite peg-risk score, 0–100 (higher = riskier); the single number a
    /// consumer (e.g. tokens.xyz's risk block) can surface without Pegana's model.
    /// Derived on `/v1/assets` (`risk_score.rs`); omitted when unavailable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub risk_score: Option<u8>,
    /// Circulating market cap in USD (circulating supply × market price, mig 0065).
    /// Serialized as a decimal string; omitted when either factor is unavailable.
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "crate::serde_fmt::opt_dec_money2"
    )]
    pub market_cap: Option<Decimal>,
    /// RFC3339 of the latest snapshot. Omitted when none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    /// Sub-C systemic exposure: how much leverage rides on this token across Solana
    /// lending markets, and how much liquidates at each depeg depth. An ADVISORY
    /// model estimate (its own `advisory_note`); namespaced here so it never blurs
    /// the verifiable peg fields above. Omitted when the token carries no tracked leverage.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub systemic: Option<SystemicSignal>,
    /// True whenever there is no trustworthy fresh discount: `state` is
    /// UNKNOWN or absent, OR `updated_at` is older than the 15-min freshness
    /// bound or absent. `updated_at` can be fresh while `stale` is true (it may
    /// be the intrinsic leg's time when the market leg is missing; see
    /// `state_reason` `market_unavailable` on `/v1/assets`).
    pub stale: bool,
    /// Human/agent verify pointer for this asset.
    pub receipt_url: String,
}

/// Batch envelope: a `data` array of per-asset signals (each carries its own
/// `mint`), consistent with every other `/v1` list. `methodology` is the global
/// version stamped once on the envelope (not repeated per signal). tokens.xyz
/// indexes `data[]` by each signal's `mint` into its own per-currency buckets.
#[derive(Debug, Serialize, ToSchema)]
pub struct PegFeedResponse {
    pub ok: bool,
    pub methodology: String,
    /// RFC3339 build time; an explicit staleness read independent of HTTP headers.
    pub generated_at: String,
    pub count: usize,
    pub data: Vec<PegSignal>,
}

/// Pure field-map of one `AssetCard` → `PegSignal`. `now` is injected so the
/// freshness/derivation logic is testable. The global methodology version is
/// stamped on the batch envelope, not on each signal.
fn card_to_signal(card: AssetCard, now: DateTime<Utc>) -> PegSignal {
    // Canonical www host (the apex 308-redirects), symbol percent-encoded:
    // `hyloSOL+` must not arrive as "hyloSOL " (a raw `+` is a space in a query).
    let receipt_url = format!(
        "https://www.pegana.xyz/audit?asset={}",
        encode_query_value(&card.symbol)
    );
    // Scale in Decimal, round to 4 dp, then convert: `to_f64() * 10000` leaked
    // binary noise (0.00017 -> 1.7000000000000002).
    let discount_bps = card
        .discount
        .and_then(|d| d.checked_mul(Decimal::from(10_000)))
        .and_then(|bps| bps.round_dp(4).to_f64());
    // `stale` is the single freshness gate partners (tokens.xyz) branch on, so it
    // MUST be true whenever the peg computation is untrustworthy. `updated_at` is
    // COALESCE(discount_ts, intrinsic_ts) upstream, so a dead MARKET leg with a
    // still-ticking on-chain NAV kept `updated_at` fresh → `stale:false` even
    // though `state` was UNKNOWN (the feed was dark). A None/UNKNOWN state has no
    // trustworthy discount, so force stale regardless of the (intrinsic-fresh)
    // timestamp — "missing data is not confirming data", ADR-0019 (QA 2026-07-23).
    let stale = matches!(card.state.as_deref(), None | Some("UNKNOWN"))
        || card
            .updated_at
            .is_none_or(|t| now - t > chrono::Duration::minutes(FRESHNESS_MINUTES));
    let updated_at = card
        .updated_at
        .map(|t| crate::serde_fmt::rfc3339_millis_z(&t));
    PegSignal {
        mint: card.mint,
        symbol: card.symbol,
        name: card.name,
        class: card.class,
        anchor: card.anchor,
        peg_target: card.peg_target,
        decimals: card.decimals,
        state: card.state,
        discount: card.discount,
        discount_raw: card.discount_raw,
        discount_bps,
        intrinsic_usd: card.intrinsic_usd,
        market_usd: card.market_usd,
        confidence: card.confidence,
        calibration: card.calibration,
        monitoring_only: card.monitoring_only,
        worst_abs_24h: card.worst_abs_24h,
        jitter_bps_24h: card.jitter_bps_24h,
        risk_score: card.risk_score,
        market_cap: card.market_cap,
        updated_at,
        // Attached by the caller (feed / feed_by_mint) from the loop tables — a
        // pure card carries no systemic data, so default to None here.
        systemic: None,
        stale,
        receipt_url,
    }
}

/// Percent-encode a query-string value (RFC 3986: everything but unreserved
/// `A-Za-z0-9-._~`).
fn encode_query_value(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    for b in v.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Latest released methodology version (mirrors `methodology::current`'s query),
/// falling back to the seeded baseline on an un-migrated DB.
async fn current_methodology_version(pg: &sqlx::PgPool) -> String {
    sqlx::query_scalar::<_, String>(
        "SELECT version FROM methodology_versions ORDER BY released_at DESC LIMIT 1",
    )
    .fetch_optional(pg)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "0.1.0".to_string())
}

/// Deterministic weak ETag over the serialized body; sha256 (stable across
/// processes and std/Rust versions), truncated to 128 bits. Lets high-volume
/// pollers (tokens.xyz) get cheap 304s.
fn weak_etag(body: &str) -> String {
    let digest = Sha256::digest(body.as_bytes());
    format!("W/\"{}\"", hex::encode(&digest[..16]))
}

pub(crate) fn request_not_modified(
    req_headers: &HeaderMap,
    etag: &str,
    last_modified: Option<&DateTime<Utc>>,
) -> bool {
    // RFC 9110: If-None-Match takes precedence over If-Modified-Since.
    if let Some(value) = req_headers.get(header::IF_NONE_MATCH) {
        return value.to_str().is_ok_and(|candidates| {
            candidates
                .split(',')
                .map(str::trim)
                .any(|candidate| candidate == "*" || candidate == etag)
        });
    }

    let Some(last_modified) = last_modified else {
        return false;
    };
    req_headers
        .get(header::IF_MODIFIED_SINCE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| DateTime::parse_from_rfc2822(value).ok())
        // HTTP dates have one-second precision.
        .is_some_and(|since| last_modified.timestamp() <= since.timestamp())
}

#[utoipa::path(
    get,
    path = "/v1/peg/feed",
    tag = "peg",
    operation_id = "peg_feed",
    summary = "Batch peg signal for every active asset (data array, each signal carries its mint)",
    responses(
        (status = 200, description = "Peg signal for all active assets as a `data` array; index by each signal's `mint`", body = PegFeedResponse),
        (status = 304, description = "Not modified (If-None-Match matched the current ETag)"),
        (status = 429, description = "Rate limit exceeded; see Retry-After header", body = ApiError),
        (status = 500, description = "Unexpected server error", body = ApiError)
    )
)]
pub async fn feed(
    State(state): State<Arc<AppState>>,
    req_headers: HeaderMap,
) -> Result<Response, ApiError> {
    let methodology = current_methodology_version(&state.pg).await;

    // Reuse the SAME 5s Redis cache `/v1/assets` (list) populates — feed() consumes
    // the identical unfiltered `fetch_assets_list(None, None)` result, so it was
    // re-running the heavy per-asset LATERAL-join query on EVERY request while the
    // list endpoint served the same data from Redis. The cache is a pure latency
    // optimisation (a Redis miss/error falls straight through to Postgres) and
    // sharing the key also keeps /feed and /assets on the same snapshot.
    let mut redis_conn = state.redis_connection().await.ok();
    let cached: Option<Vec<AssetCard>> = if let Some(conn) = redis_conn.as_mut() {
        redis::cmd("GET")
            .arg(ASSETS_LIST_CACHE_KEY)
            .query_async::<Option<String>>(conn)
            .await
            .ok()
            .flatten()
            .and_then(|j| serde_json::from_str::<Vec<AssetCard>>(&j).ok())
    } else {
        None
    };
    let cards = match cached {
        Some(c) => c,
        None => {
            let c = fetch_assets_list(&state.pg, None, None)
                .await
                .map_err(ApiError::db)?;
            // Populate the shared cache on a miss (same key + TTL as list()).
            if let Some(conn) = redis_conn.as_mut() {
                if let Ok(json) = serde_json::to_string(&c) {
                    let _: Result<(), _> = redis::cmd("SETEX")
                        .arg(ASSETS_LIST_CACHE_KEY)
                        .arg(ASSETS_LIST_CACHE_TTL_SECS)
                        .arg(&json)
                        .query_async::<()>(conn)
                        .await;
                }
            }
            c
        }
    };

    // Sub-C systemic exposure, keyed by asset symbol — one batch pair of queries
    // for the whole feed. Advisory + resilient: a DB error degrades to an empty map
    // (the feed still serves its verifiable peg fields), never a 500.
    // A degraded (empty) systemic block must never be cached downstream or by
    // the in-process hot cache (hot_cache.rs skips `no-store` responses).
    let (systemic_map, systemic_degraded) = match systemic_signal_map(&state.pg).await {
        Ok(m) => (m, false),
        Err(e) => {
            tracing::warn!(error = %e, "peg feed: systemic block degraded to empty");
            (Default::default(), true)
        }
    };

    let now = Utc::now();
    // Newest snapshot across assets → Last-Modified.
    let mut last_modified: Option<DateTime<Utc>> = None;
    let mut data: Vec<PegSignal> = Vec::new();
    for card in cards {
        // Mint is the join key; an asset without one can't be consumed by
        // tokens.xyz and would collide on the empty string. Skip it.
        if card.mint.is_empty() {
            continue;
        }
        if let Some(u) = card.updated_at {
            last_modified = Some(last_modified.map_or(u, |m| m.max(u)));
        }
        let symbol = card.symbol.clone();
        let mut sig = card_to_signal(card, now);
        sig.systemic = systemic_map.get(&symbol).cloned();
        data.push(sig);
    }
    // Stable order (by mint) → deterministic ETag across requests, preserving the
    // old mint-keyed BTreeMap's ordering guarantee now that `data` is an array.
    data.sort_by(|a, b| a.mint.cmp(&b.mint));
    let body = PegFeedResponse {
        ok: true,
        methodology,
        generated_at: crate::serde_fmt::rfc3339_millis_z(&now),
        count: data.len(),
        data,
    };
    let json = serde_json::to_string(&body).map_err(ApiError::internal)?;
    // `generated_at` changes per request but not the semantic feed content.
    // Exclude it from the weak validator so unchanged data can return 304.
    let etag_payload =
        serde_json::to_string(&(&body.methodology, &body.data)).map_err(ApiError::internal)?;
    let etag = weak_etag(&etag_payload);

    // Response headers: shared 5s cache (mirrors list()) + ETag + Last-Modified.
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(if systemic_degraded {
            "no-store"
        } else {
            "public, max-age=5, stale-while-revalidate=10"
        }),
    );
    if let Ok(v) = HeaderValue::from_str(&etag) {
        headers.insert(header::ETAG, v);
    }
    if let Some(lm) = last_modified.as_ref() {
        if let Ok(v) = HeaderValue::from_str(&lm.format("%a, %d %b %Y %H:%M:%S GMT").to_string()) {
            headers.insert(header::LAST_MODIFIED, v);
        }
    }

    // Conditional GET — 304 (no body) when either validator still matches.
    if request_not_modified(&req_headers, &etag, last_modified.as_ref()) {
        return Ok((StatusCode::NOT_MODIFIED, headers).into_response());
    }

    // Return the already-serialised JSON verbatim with an explicit content type
    // (same idiom as the assets-list cache-hit path).
    Ok((
        headers,
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        )],
        json,
    )
        .into_response())
}

#[utoipa::path(
    get,
    path = "/v1/peg/feed/by-mint/{mint}",
    tag = "peg",
    operation_id = "peg_feed_by_mint",
    summary = "Peg signal for a single asset by mint",
    params(
        ("mint" = String, Path, description = "SPL mint address (base58); the tokens.xyz join key.")
    ),
    responses(
        (status = 200, description = "Peg signal for the asset", body = PegSignal),
        (status = 400, description = "invalid_asset: the mint path parameter is malformed (mint must be a base58 Solana address, 32-44 chars)", body = ApiError),
        (status = 404, description = "unknown_asset: no active, public asset with that mint (synth_lev, e.g. xSOL, is not public)", body = ApiError)
    )
)]
pub async fn feed_by_mint(
    State(state): State<Arc<AppState>>,
    Path(mint): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    // Single-resource GET: returns the bare `PegSignal` (the same shape as one
    // element of the batch feed's `data[]`), per the API's list-vs-single
    // convention — lists are enveloped, single resources are the object itself.
    crate::routes::assets::resolve_mint(&state.pg, &mint).await?;
    let card = fetch_card(&state.pg, "a.mint", &mint)
        .await?
        .ok_or_else(|| ApiError::unknown_asset(&mint))?;
    let mut signal = card_to_signal(card, Utc::now());
    // Same rule as feed(): a degraded systemic block is served but never cached.
    let systemic_degraded = match systemic_signal_for(&state.pg, &signal.symbol).await {
        Ok(s) => {
            signal.systemic = s;
            false
        }
        Err(e) => {
            tracing::warn!(error = %e, "peg feed by mint: systemic block degraded");
            true
        }
    };
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(if systemic_degraded {
            "no-store"
        } else {
            "public, max-age=5, stale-while-revalidate=10"
        }),
    );
    Ok((headers, Json(signal)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn sample_card() -> AssetCard {
        AssetCard {
            symbol: "jitoSOL".into(),
            name: "Jito Staked SOL".into(),
            mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn".into(),
            class: "lst".into(),
            anchor: "NAV".into(),
            risk_side: crate::schema::risk_side_for_class("lst").into(),
            peg_target: "SOL".into(),
            decimals: 9,
            state: Some("PEGGED".into()),
            discount: Some(Decimal::from_str("-0.007405").unwrap()),
            discount_raw: None,
            risk_score: None,
            intrinsic_usd: Some(Decimal::from_str("180.5").unwrap()),
            market_usd: Some(Decimal::from_str("179.2").unwrap()),
            updated_at: None,
            series_24h: None,
            sol_per_lst: None,
            confidence: Some("high".into()),
            thresholds: None,
            monitoring_only: false,
            monitoring_reason: None,
            monitoring_since: None,
            calibration: "calibrated".into(),
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

    #[test]
    fn pegsignal_omits_none_and_keeps_required() {
        let sig = card_to_signal(
            {
                let mut c = sample_card();
                c.symbol = "USDC".into();
                c.mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".into();
                c.discount = None;
                c.intrinsic_usd = None;
                c.market_usd = None;
                c
            },
            "2026-06-24T12:00:00Z".parse::<DateTime<Utc>>().unwrap(),
        );
        let v = serde_json::to_value(&sig).unwrap();
        assert_eq!(v["mint"], "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
        assert_eq!(v["calibration"], "calibrated");
        assert_eq!(v["monitoring_only"], false);
        assert_eq!(v["stale"], true);
        assert_eq!(v["receipt_url"], "https://www.pegana.xyz/audit?asset=USDC");
        // None fields OMITTED (not null).
        assert!(v.get("discount").is_none());
        assert!(v.get("discount_bps").is_none());
        assert!(v.get("updated_at").is_none());
        // methodology is stamped on the batch envelope only, never per signal.
        assert!(v.get("methodology").is_none());
        // Systemic is attached by the handler from the loop tables, never by the
        // pure card mapping — so a bare card omits it entirely.
        assert!(v.get("systemic").is_none());
    }

    /// Regression for the float-noise values seen on the live feed, and for
    /// symbols that need encoding in the receipt link.
    #[test]
    fn discount_bps_is_clean_and_receipt_url_is_encoded() {
        let now = "2026-06-24T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        for (d, want) in [
            ("0.00017", 1.7),
            ("0.001017", 10.17),
            ("0.000079", 0.79),
            ("0.001799", 17.99),
        ] {
            let mut c = sample_card();
            c.discount = Some(Decimal::from_str(d).unwrap());
            assert_eq!(card_to_signal(c, now).discount_bps, Some(want), "{d}");
        }
        let mut c = sample_card();
        c.symbol = "hyloSOL+".into();
        assert_eq!(
            card_to_signal(c, now).receipt_url,
            "https://www.pegana.xyz/audit?asset=hyloSOL%2B"
        );
        assert_eq!(encode_query_value("USD*"), "USD%2A");
    }

    #[test]
    fn card_to_signal_derives_bps_receipt_and_stale() {
        let now = "2026-06-24T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let sig = card_to_signal(sample_card(), now);
        let bps = sig.discount_bps.unwrap();
        assert_eq!(bps, -74.05, "exact, no float noise");
        assert_eq!(
            sig.receipt_url,
            "https://www.pegana.xyz/audit?asset=jitoSOL"
        );
        assert!(sig.updated_at.is_none());
        assert!(sig.stale);
    }

    #[test]
    fn card_to_signal_fresh_vs_stale_window() {
        let now = "2026-06-24T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let mut fresh = sample_card();
        fresh.updated_at = Some("2026-06-24T11:55:00Z".parse().unwrap()); // 5 min ago
        assert!(!card_to_signal(fresh, now).stale);

        let mut old = sample_card();
        old.updated_at = Some("2026-06-24T11:40:00Z".parse().unwrap()); // 20 min ago
        let sig = card_to_signal(old, now);
        assert!(sig.stale);
        assert_eq!(sig.updated_at.as_deref(), Some("2026-06-24T11:40:00.000Z"));
    }

    #[test]
    fn card_to_signal_carries_risk_score_and_market_cap() {
        let now = "2026-06-24T12:00:00Z".parse::<DateTime<Utc>>().unwrap();

        // Present → carried through (risk_score as a number, market_cap as a
        // decimal string, mirroring the other Decimal fields on the feed).
        let mut c = sample_card();
        c.risk_score = Some(42);
        c.market_cap = Some(Decimal::from(1_000_000));
        let v = serde_json::to_value(card_to_signal(c, now)).unwrap();
        assert_eq!(v["risk_score"], 42);
        assert_eq!(v["market_cap"], "1000000");

        // Absent → omitted (not null), like every other Option field on the feed.
        let bare = serde_json::to_value(card_to_signal(sample_card(), now)).unwrap();
        assert!(bare.get("risk_score").is_none());
        assert!(bare.get("market_cap").is_none());
    }

    /// End-to-end serialization on the REAL `PegSignal` struct: noisy DB-scale
    /// inputs must come out clean on the wire (the whole point of the polish),
    /// with values preserved. Exercises the exact `serde_json::to_string` path
    /// the `feed()` handler uses.
    #[test]
    fn feed_decimals_and_timestamp_serialize_clean() {
        let now = "2026-07-24T18:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let mut c = sample_card();
        // 18/19-scale NUMERIC noise straight from Postgres.
        c.intrinsic_usd = Some(Decimal::from_str("3.582350020000000000").unwrap());
        c.market_usd = Some(Decimal::from_str("3.581780230000000000").unwrap());
        c.discount = Some(Decimal::from_str("-0.007405").unwrap());
        c.market_cap = Some(Decimal::from_str("806135332.1103866692430900000").unwrap());
        c.updated_at = Some("2026-07-24T17:59:12.926597+00:00".parse().unwrap());
        let v = serde_json::to_value(card_to_signal(c, now)).unwrap();

        // Price/discount: trailing-zero noise stripped, value identical.
        assert_eq!(v["intrinsic_usd"], "3.58235002");
        assert_eq!(v["market_usd"], "3.58178023");
        assert_eq!(v["discount"], "-0.007405");
        // USD aggregate: rounded to the cent.
        assert_eq!(v["market_cap"], "806135332.11");
        // Timestamp: canonical millisecond-Z (same instant, not the µs+offset form).
        assert_eq!(v["updated_at"], "2026-07-24T17:59:12.926Z");
    }

    #[test]
    fn feed_response_is_array_with_envelope_and_count() {
        let now = "2026-06-24T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let card = sample_card();
        let mint = card.mint.clone();
        let data = vec![card_to_signal(card, now)];
        let resp = PegFeedResponse {
            ok: true,
            methodology: "0.4.0".into(),
            generated_at: now.to_rfc3339(),
            count: data.len(),
            data,
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["count"], 1);
        // methodology is on the envelope (once), not on each signal.
        assert_eq!(v["methodology"], "0.4.0");
        // `data` is an array; each entry carries its own `mint`.
        let arr = v["data"].as_array().expect("data is an array");
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["mint"], mint);
        assert_eq!(arr[0]["symbol"], "jitoSOL");
        assert!(arr[0].get("methodology").is_none());
    }

    #[test]
    fn weak_etag_is_deterministic_and_changes_with_body() {
        let a = weak_etag("{\"count\":1}");
        let b = weak_etag("{\"count\":1}");
        let c = weak_etag("{\"count\":2}");
        assert_eq!(a, b, "same body => same etag");
        assert_ne!(a, c, "different body => different etag");
        assert!(a.starts_with("W/\""), "weak etag form: {a}");
    }

    #[test]
    fn conditional_get_honors_etag_precedence_and_last_modified() {
        let etag = weak_etag("{\"count\":1}");
        let last_modified = "2026-06-24T12:00:00Z".parse::<DateTime<Utc>>().unwrap();

        let mut by_etag = HeaderMap::new();
        by_etag.insert(
            header::IF_NONE_MATCH,
            HeaderValue::from_str(&format!("W/\"other\", {etag}")).unwrap(),
        );
        assert!(request_not_modified(&by_etag, &etag, Some(&last_modified)));

        let mut by_date = HeaderMap::new();
        by_date.insert(
            header::IF_MODIFIED_SINCE,
            HeaderValue::from_static("Wed, 24 Jun 2026 12:00:00 GMT"),
        );
        assert!(request_not_modified(&by_date, &etag, Some(&last_modified)));

        // A present, non-matching ETag suppresses the less precise date validator.
        by_date.insert(
            header::IF_NONE_MATCH,
            HeaderValue::from_static("W/\"different\""),
        );
        assert!(!request_not_modified(&by_date, &etag, Some(&last_modified)));
    }
}
