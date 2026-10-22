//! DexScreener USD-price market source.
//!
//! Free public API at `api.dexscreener.com/tokens/v1/solana/{mint}` returns
//! a list of trading pairs sorted by liquidity. We take the top pair's
//! `priceUsd` as the market price. No auth, ~300 req/min limit.
//!
//! Used as a fallback for assets that have NO Pyth spot feed and where
//! Jupiter lite-api is rate-limited (R2). Currently wired for sUSD, ONyc,
//! pbUSDC, USD*.
//!
//! Cadence: 30s per asset, batched as one HTTP request per asset (the
//! endpoint doesn't support multi-mint lookups). With ~4 assets that's
//! 8 req/min — well inside the rate limit.

use crate::sinks;
use crate::state::AppState;
use anyhow::{Context, Result};
use pegana_common::{AssetConfig, MarketStrategy};
use rust_decimal::Decimal;
use serde::Deserialize;
use std::str::FromStr;
use std::time::Duration;
use tokio::time::{interval, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

/// Endpoint base. Per-mint pair lookup.
const DEXSCREENER_URL: &str = "https://api.dexscreener.com/tokens/v1/solana";

/// Tolerate stale liquidity / outage — keep polling each asset on its own
/// tick so one slow asset doesn't block the others.
const DEFAULT_POLL_MS: u64 = 30_000;

/// Max premium a DexScreener `priceUsd` may carry over the asset's intrinsic
/// NAV before we treat it as a bad tick. `0.10` = reject anything >10% above
/// NAV. Override via `DEXSCREENER_MAX_PREMIUM` (e.g. "0.10").
///
/// ASYMMETRIC ON PURPOSE: this gate only rejects *premiums* (market > NAV). A
/// redeemable USD stable has no economic reason to trade far above its
/// redemption value — arbitrageurs would redeem — so a large premium on a thin
/// pair (pbUSDC's ~$65k Raydium pool periodically printed $1.46/$1.80/$2.34 vs
/// ~$1.10 NAV) is always bad data. The *discount* side (market < NAV) is a
/// genuine depeg/redemption-stress signal and MUST always pass — never gated.
const DEFAULT_MAX_PREMIUM: &str = "0.10";

/// How far back an intrinsic NAV may be and still serve as the gate reference.
/// NAV is slow-moving (validated to [0.99, 2.0) at the piggybank source), so a
/// generous window keeps the gate active across normal NAV cadence gaps; if no
/// NAV is this fresh, the gate is skipped (graceful — never blocks on missing
/// reference data, the engine's own anomaly clamp remains the backstop).
const NAV_REFERENCE_WINDOW_SECS: i64 = 86_400;

/// Minimum USD liquidity the best (deepest) DexScreener pair must carry before we
/// trust its price as a peg VERDICT input. Override via `DEXSCREENER_MIN_LIQUIDITY_USD`.
///
/// A stablecoin priced off a pool thinner than this is trivially manipulable: on a
/// constant-product AMM a price move of the ~20bps DRIFT band needs a trade of only
/// ~0.1% of liquidity, so a ~$25 sell moves a $25k pool 20bps → a FALSE DRIFT/DEPEG.
/// sUSD's sole market is a ~$8k Raydium pool; pbUSDC's ~$65k pool printed garbage and
/// was deactivated (mig 0040). This is a CREDIBILITY floor, not manipulation-immunity
/// (no free-DEX pool for these small stables is deep enough to be truly safe) — below
/// it we publish NO market tick, so the asset degrades to honest UNKNOWN (insufficient
/// depth) rather than a false alert. Set to `0` to disable; genuinely dust assets may
/// still warrant deactivation (the pbUSDC precedent).
const DEFAULT_MIN_LIQUIDITY_USD: f64 = 25_000.0;

fn max_premium() -> Decimal {
    std::env::var("DEXSCREENER_MAX_PREMIUM")
        .ok()
        .and_then(|s| Decimal::from_str(&s).ok())
        .unwrap_or_else(|| Decimal::from_str(DEFAULT_MAX_PREMIUM).unwrap())
}

fn min_liquidity_usd() -> f64 {
    std::env::var("DEXSCREENER_MIN_LIQUIDITY_USD")
        .ok()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(DEFAULT_MIN_LIQUIDITY_USD)
}

/// Should this market price be rejected as an implausible premium over NAV?
/// Pure for testability. Returns `false` (accept) when there is no positive
/// NAV reference — the caller only consults this when a fresh NAV exists.
fn is_implausible_premium(price: Decimal, nav: Decimal, max_premium: Decimal) -> bool {
    nav > Decimal::ZERO && price > nav * (Decimal::ONE + max_premium)
}

/// Should the best pair be rejected for insufficient liquidity? Pure for
/// testability. A `floor` of `0.0` disables the gate (no non-negative liquidity
/// is `< 0.0`). Missing liquidity (→ `0.0`) is always rejected under a positive
/// floor — a pair we can't measure is not one we trust for a peg verdict.
fn is_thin_liquidity(best_liquidity_usd: f64, floor: f64) -> bool {
    best_liquidity_usd < floor
}

#[derive(Debug, Deserialize)]
struct Pair {
    #[serde(rename = "priceUsd")]
    price_usd: Option<String>,
    #[serde(rename = "dexId")]
    dex_id: Option<String>,
    #[serde(rename = "pairAddress")]
    pair_address: Option<String>,
    liquidity: Option<Liquidity>,
}

#[derive(Debug, Deserialize)]
struct Liquidity {
    usd: Option<f64>,
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    // Gather the assets configured to use DexScreener as market source.
    let assets: Vec<AssetConfig> = state
        .assets
        .assets
        .iter()
        .filter(|a| a.active && matches!(a.market, MarketStrategy::DexScreenerUsd))
        .cloned()
        .collect();
    if assets.is_empty() {
        info!("no dexscreener_usd assets declared — dexscreener source idle");
        return Ok(());
    }

    let cadence_ms = std::env::var("DEXSCREENER_POLL_MS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(DEFAULT_POLL_MS);

    let mut tick = interval(Duration::from_millis(super::min_poll_ms(cadence_ms)));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    info!(
        cadence_ms,
        asset_count = assets.len(),
        "dexscreener source ready"
    );

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("dexscreener source shutdown");
                return Ok(());
            }
        }

        for asset in &assets {
            if let Err(e) = poll_one(&state, asset).await {
                warn!(asset = %asset.symbol, error = %e, "dexscreener poll failed");
                metrics::counter!(
                    "pegana_dexscreener_polls_total",
                    "asset" => asset.symbol.clone(),
                    "status" => "error"
                )
                .increment(1);
            } else {
                metrics::counter!(
                    "pegana_dexscreener_polls_total",
                    "asset" => asset.symbol.clone(),
                    "status" => "ok"
                )
                .increment(1);
            }
        }
    }
}

async fn poll_one(state: &AppState, asset: &AssetConfig) -> Result<()> {
    let started = std::time::Instant::now();
    let url = format!("{DEXSCREENER_URL}/{}", asset.mint);

    let resp = state
        .http
        .get(&url)
        .send()
        .await
        .with_context(|| format!("dexscreener get {url}"))?;
    let status = resp.status();
    if !status.is_success() {
        anyhow::bail!("dexscreener http {status}");
    }
    let pairs: Vec<Pair> = resp.json().await.context("dexscreener json parse")?;
    metrics::histogram!(
        "pegana_dexscreener_latency_seconds",
        "asset" => asset.symbol.clone()
    )
    .record(started.elapsed().as_secs_f64());

    // Pick the highest-liquidity pair that has a price.
    let best = pairs
        .iter()
        .filter(|p| p.price_usd.is_some())
        .max_by(|a, b| {
            let al = a.liquidity.as_ref().and_then(|l| l.usd).unwrap_or(0.0);
            let bl = b.liquidity.as_ref().and_then(|l| l.usd).unwrap_or(0.0);
            al.partial_cmp(&bl).unwrap_or(std::cmp::Ordering::Equal)
        })
        .context("no priced pair returned")?;

    // Min-liquidity floor (data quality). The deepest priced pair must still carry
    // credible depth, or its price is a manipulable/false peg signal (a few $k of
    // sells into a thin pool = a spurious DRIFT/DEPEG). Reject below the floor so
    // the asset degrades to honest UNKNOWN (no fresh market → engine staleness
    // gate) rather than publishing a false alert. Mirrors the premium gate below.
    let best_liquidity_usd = best.liquidity.as_ref().and_then(|l| l.usd).unwrap_or(0.0);
    if is_thin_liquidity(best_liquidity_usd, min_liquidity_usd()) {
        warn!(
            asset = %asset.symbol,
            liquidity_usd = best_liquidity_usd,
            floor = min_liquidity_usd(),
            "dexscreener best pair below min-liquidity floor — rejecting (thin pool = manipulable/false peg verdict)"
        );
        metrics::counter!(
            "pegana_dexscreener_rejected_total",
            "asset" => asset.symbol.clone(),
            "reason" => "thin_liquidity"
        )
        .increment(1);
        return Ok(());
    }

    let price_str = best.price_usd.as_deref().context("price_usd missing")?;
    let price = Decimal::from_str(price_str).with_context(|| format!("price parse {price_str}"))?;
    anyhow::ensure!(price > Decimal::ZERO, "non-positive price {price}");
    anyhow::ensure!(
        price < Decimal::from(100u32),
        "implausible price {price} for stable {}",
        asset.symbol
    );

    // Premium sanity gate (data quality). Thin DexScreener pairs intermittently
    // print garbage premiums over the asset's redemption NAV; left unfiltered
    // they either freeze the engine's state snapshot (extreme prints rejected by
    // the |discount|>1 anomaly clamp) or get published as a fake premium (milder
    // prints that slip under the clamp). Reject premiums >tol over a fresh NAV at
    // ingestion so they never enter the pipeline. Discount side always passes —
    // see DEFAULT_MAX_PREMIUM for the asymmetry rationale.
    if let Some(nav) =
        sinks::postgres::latest_intrinsic_usd(&state.pg, &asset.symbol, NAV_REFERENCE_WINDOW_SECS)
            .await
            .unwrap_or(None)
    {
        if is_implausible_premium(price, nav, max_premium()) {
            warn!(
                asset = %asset.symbol, %price, %nav,
                "dexscreener priceUsd exceeds NAV premium tolerance — rejecting bad tick"
            );
            metrics::counter!(
                "pegana_dexscreener_rejected_total",
                "asset" => asset.symbol.clone(),
                "reason" => "premium_over_nav"
            )
            .increment(1);
            return Ok(());
        }
    }

    let ts = chrono::Utc::now();
    let route_label = best.dex_id.as_deref().unwrap_or("dexscreener");

    sinks::postgres::insert_market(
        &state.pg,
        &asset.symbol,
        price,
        "USD",
        None,
        None,
        None,
        Some(route_label),
        ts,
    )
    .await
    .context("insert market snapshot")?;

    let payload = serde_json::json!({
        "asset": asset.symbol,
        "market_usd": price,
        "numeraire": "USD",
        "dex": best.dex_id,
        "pair": best.pair_address,
        "liquidity_usd": best.liquidity.as_ref().and_then(|l| l.usd),
        "ts": ts,
        "source": "dexscreener",
    });
    // Re-use SRC_JUPITER channel — the engine's SRC_JUPITER handler is
    // already wired to call set_market + try_recompute on receipt of
    // {asset, value_usd}-style envelopes. DexScreener envelopes use the
    // same shape with `market_usd` aliased to `value_usd` here.
    let payload_for_engine = serde_json::json!({
        "asset": asset.symbol,
        "value_usd": price,
        "numeraire": "USD",
        "source": "dexscreener",
        // Top-pair USD liquidity — server-only metadata the engine stows on
        // AssetRuntime + surfaces in event.extra (NOT part of the discount or
        // the receipt hash). Foundation for a future depth/liquidity gate
        // (ADR-0024, "observe first"). Null when DexScreener omits liquidity.
        "liquidity_usd": best.liquidity.as_ref().and_then(|l| l.usd),
        "ts": ts,
    });
    sinks::redis_pub::publish_tracked(
        state.redis.clone(),
        pegana_common::channels::SRC_JUPITER,
        &payload_for_engine,
        "dexscreener",
    )
    .await
    .context("publish engine envelope")?;
    // Also fire the verbose envelope on a debug channel for observability.
    let _ = payload;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> Decimal {
        Decimal::from_str(s).unwrap()
    }

    // pbUSDC's real episode: NAV ~1.097, thin-pair garbage premiums.
    #[test]
    fn rejects_garbage_premiums_over_nav() {
        let nav = d("1.097");
        let tol = d("0.10");
        assert!(
            is_implausible_premium(d("1.46"), nav, tol),
            "+33% must reject"
        );
        assert!(
            is_implausible_premium(d("1.80"), nav, tol),
            "+64% must reject"
        );
        assert!(
            is_implausible_premium(d("2.34"), nav, tol),
            "+113% must reject"
        );
    }

    #[test]
    fn accepts_near_nav_prints() {
        let nav = d("1.097");
        let tol = d("0.10");
        assert!(
            !is_implausible_premium(d("1.09"), nav, tol),
            "~NAV must pass"
        );
        assert!(
            !is_implausible_premium(d("1.18"), nav, tol),
            "+7.6% within tol must pass"
        );
    }

    #[test]
    fn thin_liquidity_floor() {
        // The default floor is 25_000.0. sUSD's ~$8k pool and a $0
        // (missing-liquidity) pair are rejected; at/above the floor passes.
        let floor = DEFAULT_MIN_LIQUIDITY_USD;
        assert!(is_thin_liquidity(8_000.0, floor), "sUSD ~$8k must reject");
        assert!(
            is_thin_liquidity(0.0, floor),
            "missing liquidity must reject"
        );
        assert!(
            is_thin_liquidity(24_999.0, floor),
            "just below floor rejects"
        );
        // At/above the floor passes.
        assert!(!is_thin_liquidity(25_000.0, floor), "at floor passes");
        assert!(!is_thin_liquidity(150_000.0, floor), "deep pool passes");
        // A floor of 0 disables the gate — nothing is rejected.
        assert!(!is_thin_liquidity(0.0, 0.0), "floor=0 disables the gate");
    }

    // The load-bearing property: a real depeg (market BELOW NAV) must NEVER be
    // gated — that's the whole point of monitoring this asset.
    #[test]
    fn never_gates_the_discount_side() {
        let nav = d("1.097");
        let tol = d("0.10");
        assert!(
            !is_implausible_premium(d("1.00"), nav, tol),
            "discount must pass"
        );
        assert!(
            !is_implausible_premium(d("0.80"), nav, tol),
            "−27% depeg must pass"
        );
        assert!(
            !is_implausible_premium(d("0.50"), nav, tol),
            "−54% depeg must pass"
        );
    }

    #[test]
    fn no_nav_reference_accepts() {
        // Defensive: a zero/absent NAV must not reject (caller only calls with a
        // fresh NAV, but the predicate must fail-open regardless).
        assert!(!is_implausible_premium(d("2.34"), Decimal::ZERO, d("0.10")));
    }
}
