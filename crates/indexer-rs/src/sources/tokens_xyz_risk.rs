//! tokens.xyz market-context source (holders / volume / market cap / liquidity).
//!
//! Reads the Solana Foundation's `GET /v1/assets/{assetId}/risk-details?mint=<mint>`
//! and persists the four size/context signals it exposes. This is the SECOND
//! tokens.xyz source; it is deliberately separate from `sources::tokens_xyz`
//! (the 60s `market-snapshots` liquidity poll) and never touches it.
//!
//! WHY A SECOND SOURCE (measured against production, 2026-08-10):
//!   - `POST /v1/assets/market-snapshots` reads their legacy `tokens` table and
//!     resolves **26 of Pegana's 69 active assets (37%)**. It carries no holder
//!     count at all.
//!   - `GET /v1/assets/{assetId}/risk-details?mint=` reads their per-variant
//!     `variant_markets_latest` and resolves **62/69 (89%)**, and it DOES carry
//!     `holderCount`. Where both have data the liquidity agrees (USDC $647.1M
//!     vs $650.3M — same Birdeye origin, different fetch times).
//!
//! So this source is strictly broader, and it lifts depth-gate calibration
//! coverage from 37% to 89% by writing liquidity under its own `source` value.
//!
//! ⚠️ THE `?mint=` PARAM IS LOAD-BEARING. `/v1/assets/resolve?mint=` collapses
//! every LST to `assetId: "solana"` and every USD stablecoin to `assetId: "usd"`
//! — that is their canonical-asset/variant model, where an LST is a `yield`
//! variant of SOL. Calling `risk-details` WITHOUT `?mint=` returns the asset's
//! PRIMARY variant: native SOL for every LST, USDC for every stablecoin. That
//! would attribute SOL's ~7.7M holders to jitoSOL. Never drop the param.
//!
//! ISOLATION (mirrors `sources::token_supply`): a separate spawned task sharing
//! no in-memory state with the NAV/discount sources. It writes ONLY the
//! `liquidity_observations` context columns added in migration 0075, and
//! **never publishes to Redis** — so nothing here can reach `compute_discount`,
//! the EWMA, the FSM, or a receipt. `cargo xtask hygiene` fails the build if
//! `engine-rs` or `methodology` so much as names one of these fields.
//!
//! Every failure is per-asset and non-fatal: a bad asset is logged and skipped,
//! never aborting the tick (which would cascade into `main.rs`'s task-exit
//! handling).

use crate::sinks;
use crate::state::AppState;
use anyhow::{Context, Result};
use rust_decimal::prelude::FromPrimitive;
use rust_decimal::Decimal;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;
use tokio::time::{interval, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

const TOKENS_XYZ_BASE: &str = "https://api.tokens.xyz/v1";
/// Holder counts and 24h volume move slowly, and this is the SECOND poll loop
/// on the same API key — the 60s `market-snapshots` liquidity poll is already
/// in production and must not be starved. 30 min measured at ~30s wall time
/// for 69 assets (464ms average latency, zero 429s).
const DEFAULT_POLL_MS: u64 = 1_800_000;
/// `assetId` for a mint is a static mapping in their registry; re-resolve daily
/// only so a newly-listed variant eventually gets picked up.
const RESOLVE_TTL_TICKS: u32 = 48;

/// Keep a reading ONLY for a real, positive, finite value; otherwise `None`.
/// Pure + total so the keep/drop rule is unit-tested without HTTP or a DB.
/// Mirrors `tokens_xyz::valid_liquidity` — ADR-0019, a missing number is never
/// reported as zero.
fn valid_amount(raw: Option<f64>) -> Option<Decimal> {
    raw.filter(|v| v.is_finite() && *v > 0.0)
        .and_then(Decimal::from_f64)
}

/// Holder count is `double precision` upstream; keep only a positive, finite
/// reading and round to the nearest whole address.
fn valid_holder_count(raw: Option<f64>) -> Option<i64> {
    raw.filter(|v| v.is_finite() && *v >= 1.0)
        .map(|v| v.round() as i64)
}

#[derive(Deserialize)]
struct ResolveResponse {
    #[serde(rename = "assetId")]
    asset_id: Option<String>,
}

#[derive(Deserialize)]
struct RiskDetailsResponse {
    risk: Option<Risk>,
}

#[derive(Deserialize)]
struct Risk {
    #[serde(default)]
    ok: bool,
    #[serde(rename = "marketScoreInput")]
    market_score_input: Option<MarketScoreInput>,
}

/// Only the four fields Pegana persists. Their payload also carries
/// `top10HoldersPercent`, `tokenMintTime` and `volume7dUsd`, but the first two
/// are hardcoded `null` on this route and the third is just `volume24h * 7`,
/// so none of them are worth a column.
#[derive(Deserialize)]
struct MarketScoreInput {
    #[serde(rename = "holderCount")]
    holder_count: Option<f64>,
    #[serde(rename = "liquidityUsd")]
    liquidity_usd: Option<f64>,
    #[serde(rename = "volume24hUsd")]
    volume_24h_usd: Option<f64>,
    #[serde(rename = "marketCapUsd")]
    market_cap_usd: Option<f64>,
}

/// Outcome of one asset's poll — drives the per-status metric.
#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    /// Persisted a row with at least one non-null context field.
    Ok,
    /// Their registry has no canonical asset for this mint, or the variant has
    /// no cached market. Expected for 7 of Pegana's 69 assets (the exotic
    /// `stable_yield` singletons + `xSOL`), NOT an error.
    NotFound,
    /// Transport / decode / persist failure.
    Error,
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    let api_key = match state.config.tokens_xyz_api_key.clone() {
        Some(k) if !k.is_empty() => k,
        _ => {
            info!("TOKENS_XYZ_API_KEY unset — tokens.xyz market-context source idle");
            return Ok(());
        }
    };

    let mints: Vec<(String, String)> = state
        .assets
        .assets
        .iter()
        .filter(|a| a.active && !a.mint.is_empty())
        .map(|a| (a.symbol.clone(), a.mint.clone()))
        .collect();
    if mints.is_empty() {
        info!("no active assets with mints — tokens.xyz market-context source idle");
        return Ok(());
    }

    let cadence_ms = std::env::var("TOKENS_XYZ_RISK_POLL_MS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(DEFAULT_POLL_MS);

    let mut tick = interval(Duration::from_millis(super::min_poll_ms(cadence_ms)));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    info!(
        cadence_ms,
        asset_count = mints.len(),
        "tokens.xyz market-context source ready"
    );

    // mint → assetId, refreshed every RESOLVE_TTL_TICKS ticks.
    let mut resolved: HashMap<String, String> = HashMap::new();
    let mut ticks_since_resolve = u32::MAX; // force a resolve on the first tick

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("tokens.xyz market-context source shutdown");
                return Ok(());
            }
        }

        if ticks_since_resolve >= RESOLVE_TTL_TICKS {
            match refresh_resolve_map(&state, &api_key, &mints).await {
                Ok(map) => {
                    info!(
                        resolved = map.len(),
                        total = mints.len(),
                        "tokens.xyz assetId map refreshed"
                    );
                    resolved = map;
                    ticks_since_resolve = 0;
                }
                Err(e) => {
                    // Keep the previous map rather than skipping the whole tick:
                    // the mapping is static, so a stale map is still correct.
                    warn!(error = %e, "tokens.xyz assetId refresh failed — reusing previous map");
                }
            }
        } else {
            ticks_since_resolve += 1;
        }

        let (ok, not_found, errors) = poll_all(&state, &api_key, &mints, &resolved).await;
        info!(ok, not_found, errors, "tokens.xyz market context persisted");

        for (status, n) in [("ok", ok), ("not_found", not_found), ("error", errors)] {
            if n > 0 {
                metrics::counter!("pegana_tokens_xyz_risk_polls_total", "status" => status)
                    .increment(n as u64);
            }
        }

        // Liveness gauge. DELIBERATELY a dedicated metric rather than the shared
        // `pegana_source_last_publish_timestamp`: that gauge is watched by
        // `PeganaSourceNotPublishing`, which fires at >300s. This source runs on
        // a 30-MINUTE cadence by design, so feeding the shared gauge would put
        // it permanently over that threshold and turn a working alert into
        // noise. Its own gauge gets its own, cadence-appropriate rule
        // (`PeganaTokensXyzRiskStale`, ops/alerts/pegana.yml).
        if ok > 0 {
            metrics::gauge!("pegana_tokens_xyz_risk_last_success_timestamp")
                .set(chrono::Utc::now().timestamp() as f64);
        }
    }
}

/// Resolve every tracked mint to its canonical tokens.xyz `assetId`.
/// A mint that fails to resolve is simply absent from the map.
async fn refresh_resolve_map(
    state: &AppState,
    api_key: &str,
    mints: &[(String, String)],
) -> Result<HashMap<String, String>> {
    let mut map = HashMap::new();
    let mut failures = 0usize;

    for (symbol, mint) in mints {
        let url = format!("{TOKENS_XYZ_BASE}/assets/resolve?mint={mint}");
        match state
            .http
            .get(&url)
            .header("x-api-key", api_key)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                match crate::http_util::json_capped::<ResolveResponse>(
                    resp,
                    crate::http_util::MAX_UPSTREAM_BODY_BYTES,
                )
                .await
                {
                    Ok(r) => {
                        if let Some(id) = r.asset_id {
                            map.insert(mint.clone(), id);
                        }
                    }
                    Err(e) => {
                        failures += 1;
                        warn!(asset = symbol, error = %e, "tokens.xyz resolve decode failed");
                    }
                }
            }
            Ok(resp) => {
                // 404 here just means the mint isn't in their registry.
                if resp.status() != reqwest::StatusCode::NOT_FOUND {
                    failures += 1;
                    warn!(asset = symbol, status = %resp.status(), "tokens.xyz resolve non-2xx");
                }
            }
            Err(e) => {
                failures += 1;
                warn!(asset = symbol, error = %e, "tokens.xyz resolve request failed");
            }
        }
    }

    anyhow::ensure!(
        !map.is_empty(),
        "resolved 0/{} mints ({failures} hard failures)",
        mints.len()
    );
    Ok(map)
}

/// Poll `risk-details` for every resolved mint. Returns `(ok, not_found, errors)`.
async fn poll_all(
    state: &AppState,
    api_key: &str,
    mints: &[(String, String)],
    resolved: &HashMap<String, String>,
) -> (usize, usize, usize) {
    let (mut ok, mut not_found, mut errors) = (0usize, 0usize, 0usize);
    let now = chrono::Utc::now();

    for (symbol, mint) in mints {
        let Some(asset_id) = resolved.get(mint) else {
            not_found += 1;
            continue;
        };
        match poll_one(state, api_key, symbol, mint, asset_id, now).await {
            Outcome::Ok => ok += 1,
            Outcome::NotFound => not_found += 1,
            Outcome::Error => errors += 1,
        }
    }

    (ok, not_found, errors)
}

async fn poll_one(
    state: &AppState,
    api_key: &str,
    symbol: &str,
    mint: &str,
    asset_id: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> Outcome {
    // `?mint=` is mandatory — see the module docs. Without it this returns the
    // canonical asset's PRIMARY variant (SOL for every LST, USDC for every
    // stablecoin), which would be silently, catastrophically wrong data.
    let url = format!("{TOKENS_XYZ_BASE}/assets/{asset_id}/risk-details?mint={mint}");

    let resp = match state
        .http
        .get(&url)
        .header("x-api-key", api_key)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            warn!(asset = symbol, error = %e, "tokens.xyz risk-details request failed");
            return Outcome::Error;
        }
    };

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Outcome::NotFound;
    }
    if !resp.status().is_success() {
        warn!(asset = symbol, status = %resp.status(), "tokens.xyz risk-details non-2xx");
        return Outcome::Error;
    }

    let body = match crate::http_util::json_capped::<RiskDetailsResponse>(
        resp,
        crate::http_util::MAX_UPSTREAM_BODY_BYTES,
    )
    .await
    {
        Ok(b) => b,
        Err(e) => {
            warn!(asset = symbol, error = %e, "tokens.xyz risk-details decode failed");
            return Outcome::Error;
        }
    };

    // `risk.ok == false` is their cache-warm trigger, not a failure: the call
    // schedules a warm on their side, so the NEXT tick usually succeeds. No
    // in-tick retry.
    let Some(input) = body
        .risk
        .filter(|r| r.ok)
        .and_then(|r| r.market_score_input)
    else {
        return Outcome::NotFound;
    };

    let liquidity_usd = valid_amount(input.liquidity_usd);
    let volume_24h_usd = valid_amount(input.volume_24h_usd);
    let market_cap_usd = valid_amount(input.market_cap_usd);
    let holder_count = valid_holder_count(input.holder_count);

    // Nothing usable came back — record it as not_found rather than writing an
    // all-NULL row that would pollute the calibration series.
    if liquidity_usd.is_none()
        && volume_24h_usd.is_none()
        && market_cap_usd.is_none()
        && holder_count.is_none()
    {
        return Outcome::NotFound;
    }

    if let Err(e) = sinks::postgres::insert_market_context_observation(
        &state.pg,
        symbol,
        "tokens_xyz_risk",
        liquidity_usd,
        volume_24h_usd,
        market_cap_usd,
        holder_count,
        now,
    )
    .await
    .context("persist tokens.xyz market context")
    {
        warn!(asset = symbol, error = %e, "tokens.xyz market-context persist failed");
        return Outcome::Error;
    }

    Outcome::Ok
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn valid_amount_keeps_only_real_positive_readings() {
        assert_eq!(valid_amount(None), None);
        assert_eq!(valid_amount(Some(0.0)), None);
        assert_eq!(valid_amount(Some(-5.0)), None);
        assert_eq!(valid_amount(Some(f64::NAN)), None);
        assert_eq!(valid_amount(Some(f64::INFINITY)), None);
        assert_eq!(
            valid_amount(Some(1_367_674.44)),
            Some(Decimal::from_str("1367674.44").unwrap())
        );
    }

    #[test]
    fn holder_count_rejects_junk_and_rounds() {
        assert_eq!(valid_holder_count(None), None);
        assert_eq!(valid_holder_count(Some(0.0)), None);
        assert_eq!(valid_holder_count(Some(-3.0)), None);
        assert_eq!(valid_holder_count(Some(f64::NAN)), None);
        // A single holder is a real reading, not junk.
        assert_eq!(valid_holder_count(Some(1.0)), Some(1));
        assert_eq!(valid_holder_count(Some(185_395.0)), Some(185_395));
        assert_eq!(valid_holder_count(Some(41_775.6)), Some(41_776));
    }

    /// The exact `risk.ok = true` shape observed in production on 2026-08-10
    /// for jitoSOL, decoded end to end.
    #[test]
    fn decodes_real_risk_details_payload() {
        let raw = r#"{
            "assetId": "solana",
            "mint": "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
            "risk": {
                "ok": true,
                "marketScoreInput": {
                    "liquidityUsd": 785794605.7404523,
                    "marketCapUsd": 768504808.5267464,
                    "holderCount": 185395,
                    "top10HoldersPercent": null,
                    "volume24hUsd": 6170628.390470825,
                    "volume7dUsd": 43194398.73329578,
                    "tokenMintTime": null,
                    "tokenAddress": "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"
                },
                "tags": [],
                "lastUpdatedAt": 1786366877607
            }
        }"#;
        let parsed: RiskDetailsResponse = serde_json::from_str(raw).expect("decode");
        let input = parsed
            .risk
            .filter(|r| r.ok)
            .and_then(|r| r.market_score_input)
            .expect("marketScoreInput present");
        assert_eq!(valid_holder_count(input.holder_count), Some(185_395));
        // `Decimal::from_f64` keeps ~15 significant digits, so the JSON's
        // 6170628.390470825 lands as 6170628.39047083. That 5e-9 USD of drift
        // is immaterial for a context signal (and these columns never touch the
        // discount/receipt path), but assert the ACTUAL value rather than the
        // wire value so the conversion's behaviour stays pinned.
        assert_eq!(
            valid_amount(input.volume_24h_usd),
            Some(Decimal::from_str("6170628.39047083").unwrap())
        );
        assert!(valid_amount(input.liquidity_usd).is_some());
        assert!(valid_amount(input.market_cap_usd).is_some());
    }

    /// The `not_found` shape: no `marketScoreInput` at all, `ok = false`.
    #[test]
    fn treats_not_ok_risk_as_absent_input() {
        let raw = r#"{
            "assetId": "solana",
            "mint": "So11111111111111111111111111111111111111112",
            "risk": { "ok": false, "reason": "not_found", "message": "Market snapshot not available in cache" }
        }"#;
        let parsed: RiskDetailsResponse = serde_json::from_str(raw).expect("decode");
        assert!(parsed
            .risk
            .filter(|r| r.ok)
            .and_then(|r| r.market_score_input)
            .is_none());
    }

    #[test]
    fn resolve_response_decodes() {
        let raw = r#"{"assetId":"usd","asset":{"assetId":"usd"},"variant":{"mint":"x"}}"#;
        let parsed: ResolveResponse = serde_json::from_str(raw).expect("decode");
        assert_eq!(parsed.asset_id.as_deref(), Some("usd"));
    }
}
