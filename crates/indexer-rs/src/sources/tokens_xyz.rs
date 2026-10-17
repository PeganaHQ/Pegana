//! tokens.xyz liquidity source.
//!
//! Batch-fetches raw USD liquidity for every active asset from the Solana
//! Foundation's tokens.xyz market-snapshots API and publishes it as server-only
//! `liquidity_usd` metadata on the engine envelope (→ `event.extra`, the same
//! path the DexScreener source uses). Broad coverage (all active assets, since
//! tokens.xyz resolves any Solana mint) complements DexScreener's narrow-but-raw
//! 3-asset coverage.
//!
//! Endpoint: `POST /v1/assets/market-snapshots` with `{ "mints": [...] }`
//! (≤250 mints/call) → `[{ address, hasMarket, token: { liquidity, ... } }]`.
//! Auth: `x-api-key` (`TOKENS_XYZ_API_KEY`).
//!
//! Liquidity is slow-moving and NEVER participates in the discount/FSM/receipt
//! (the engine stows it as inert metadata — see `AssetRuntime::set_liquidity`).
//! So a slow cadence and tolerant error handling are fine: a dead feed just
//! means the engine keeps its last-seen liquidity, never a stalled pipeline.
//! (A liquidity *gate* — Tier 3 Step 2 — would need an explicit freshness
//! guard; this source intentionally does not gate anything.) As of Phase 1
//! (ADR-0026) the ENGINE caps confidence high→medium on a thin, fresh reading
//! of this same signal (via `EngineState::liquidity_usd_fresh` +
//! `depth_gate_fires` in `engine-rs`) — still no change on the indexer side;
//! this source still does not gate or alter the verdict, and ships with the
//! engine-side gate DISABLED by default (see `main.rs`'s `DEPTH_GATE_FLOOR_USD`).
//! As of Spec 04 Phase 0 the source ALSO persists every observation (incl.
//! has_market=false / junk rows, stored as NULL) to `liquidity_observations`
//! for depth-gate calibration. This is OBSERVE-ONLY: it still does not gate or
//! alter the verdict; the engine envelope is unchanged.

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

const TOKENS_XYZ_URL: &str = "https://api.tokens.xyz/v1/assets/market-snapshots";
/// Liquidity is slow-moving; 60s keeps the feed fresh without burning quota.
const DEFAULT_POLL_MS: u64 = 60_000;
/// The API's documented batch cap.
const MAX_MINTS_PER_CALL: usize = 250;

/// Keep a liquidity reading ONLY for a market that exists with a real,
/// positive, finite value; otherwise `None` (has_market=false OR junk tick).
/// Pure + total so the keep/drop rule is unit-tested without HTTP or a DB.
fn valid_liquidity(has_market: bool, raw: Option<f64>) -> Option<Decimal> {
    if !has_market {
        return None;
    }
    raw.filter(|l| l.is_finite() && *l > 0.0)
        .and_then(Decimal::from_f64)
}

#[derive(Deserialize)]
struct Snapshot {
    address: String,
    #[serde(rename = "hasMarket")]
    has_market: bool,
    token: Option<TokenData>,
}

#[derive(Deserialize)]
struct TokenData {
    /// Raw USD liquidity of the deepest market. `None`/null when tokens.xyz has
    /// no market for the mint.
    liquidity: Option<f64>,
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    let api_key = match state.config.tokens_xyz_api_key.clone() {
        Some(k) if !k.is_empty() => k,
        _ => {
            info!("TOKENS_XYZ_API_KEY unset — tokens.xyz liquidity source idle");
            return Ok(());
        }
    };

    // Every active asset with a mint (tokens.xyz resolves any Solana mint).
    let mints: Vec<(String, String)> = state
        .assets
        .assets
        .iter()
        .filter(|a| a.active && !a.mint.is_empty())
        .map(|a| (a.symbol.clone(), a.mint.clone()))
        .collect();
    if mints.is_empty() {
        info!("no active assets with mints — tokens.xyz source idle");
        return Ok(());
    }

    let cadence_ms = std::env::var("TOKENS_XYZ_POLL_MS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(DEFAULT_POLL_MS);

    let mut tick = interval(Duration::from_millis(cadence_ms));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    info!(
        cadence_ms,
        asset_count = mints.len(),
        "tokens.xyz liquidity source ready"
    );

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("tokens.xyz source shutdown");
                return Ok(());
            }
        }

        match poll_batch(&state, &api_key, &mints).await {
            Ok(published) => {
                info!(published, "tokens.xyz liquidity published");
                metrics::counter!("pegana_tokens_xyz_polls_total", "status" => "ok").increment(1);
            }
            Err(e) => {
                warn!(error = %e, "tokens.xyz liquidity poll failed");
                metrics::counter!("pegana_tokens_xyz_polls_total", "status" => "error")
                    .increment(1);
            }
        }
    }
}

/// Fetch liquidity for every mint (chunked to the batch cap) and publish a
/// liquidity-only envelope per asset. The envelope deliberately carries NO
/// `value_usd`/`market_usd`, so the engine's handler only runs `set_liquidity`
/// (no price override, no recompute).
async fn poll_batch(state: &AppState, api_key: &str, mints: &[(String, String)]) -> Result<usize> {
    let by_mint: HashMap<&str, &str> = mints
        .iter()
        .map(|(s, m)| (m.as_str(), s.as_str()))
        .collect();

    let mut published = 0usize;
    for chunk in mints.chunks(MAX_MINTS_PER_CALL) {
        let mint_list: Vec<&str> = chunk.iter().map(|(_, m)| m.as_str()).collect();
        let resp = state
            .http
            .post(TOKENS_XYZ_URL)
            .header("x-api-key", api_key)
            .json(&serde_json::json!({ "mints": mint_list }))
            .send()
            .await
            .context("tokens.xyz request")?;
        let status = resp.status();
        if !status.is_success() {
            anyhow::bail!("tokens.xyz HTTP {status}");
        }
        let snapshots: Vec<Snapshot> = resp.json().await.context("tokens.xyz decode")?;

        let now = chrono::Utc::now();
        for snap in snapshots {
            // Resolve the symbol first — Phase 0 records an observation for EVERY
            // tracked mint (incl. has_market=false), so symbol resolution precedes
            // the market check. Skip only mints we don't track.
            let Some(&symbol) = by_mint.get(snap.address.as_str()) else {
                continue;
            };
            let raw = snap.token.and_then(|t| t.liquidity);
            let liquidity_usd = valid_liquidity(snap.has_market, raw);

            // OBSERVE: persist every observation, including has_market=false /
            // junk rows (NULL liquidity). Best-effort — a DB error logs and the
            // poll continues; it must never stall the source.
            if let Err(e) = sinks::postgres::insert_liquidity_observation(
                &state.pg,
                symbol,
                "tokens_xyz",
                liquidity_usd,
                snap.has_market,
                now,
            )
            .await
            {
                warn!(error = %e, asset = symbol, "tokens.xyz liquidity observation persist failed");
            }

            // Publish to the engine ONLY for a real positive-liquidity market.
            // Keep the payload byte-identical to before: a JSON number from the
            // original f64, NOT the Decimal (engine event.extra must not change).
            if liquidity_usd.is_some() {
                if let Some(liq) = raw.filter(|l| l.is_finite() && *l > 0.0) {
                    let payload = serde_json::json!({
                        "asset": symbol,
                        "liquidity_usd": liq,
                        "source": "tokens_xyz",
                        "ts": now,
                    });
                    sinks::redis_pub::publish_tracked(
                        state.redis.clone(),
                        pegana_common::channels::SRC_JUPITER,
                        &payload,
                        "tokens_xyz",
                    )
                    .await
                    .context("publish tokens.xyz liquidity")?;
                    published += 1;
                }
            }
        }
    }
    Ok(published)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn valid_liquidity_keeps_only_real_positive_markets() {
        // has_market=false → always None, even if a number leaks through.
        assert_eq!(valid_liquidity(false, Some(123.0)), None);
        assert_eq!(valid_liquidity(false, None), None);
        // has_market=true but junk → None.
        assert_eq!(valid_liquidity(true, None), None);
        assert_eq!(valid_liquidity(true, Some(0.0)), None);
        assert_eq!(valid_liquidity(true, Some(-5.0)), None);
        assert_eq!(valid_liquidity(true, Some(f64::NAN)), None);
        assert_eq!(valid_liquidity(true, Some(f64::INFINITY)), None);
        // has_market=true + real positive → Some, as a Decimal.
        assert_eq!(
            valid_liquidity(true, Some(51000.0)),
            Some(Decimal::from_str("51000").unwrap())
        );
    }
}
