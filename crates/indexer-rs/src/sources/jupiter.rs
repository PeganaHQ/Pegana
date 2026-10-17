//! Jupiter lite-api round-robin market quote loop.
//!
//! One asset per tick to fit the 0.5 RPS keyless budget. Quote direction:
//! input = asset mint, output = numeraire mint (SOL or USDC), amount = 1 unit
//! of the asset. Compute `value_usd = (outAmount / inAmount) × pyth(numeraire/USD)`.

use crate::sinks;
use crate::state::AppState;
use anyhow::{Context, Result};
use futures::stream::{FuturesUnordered, StreamExt};
use pegana_common::{AssetConfig, MarketStrategy};
use rust_decimal::Decimal;
use serde::Deserialize;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tokio::time::{interval, sleep, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

/// Max times we'll retry a single asset on 429 before giving up for this tick.
const MAX_429_RETRIES: u32 = 2;
/// Fallback sleep when Jupiter returns 429 without a Retry-After header.
const DEFAULT_429_BACKOFF: Duration = Duration::from_secs(3);
/// Cap on any Retry-After we will honor in-line — anything bigger and we'd
/// rather bail and retry on the next tick than block the round-robin slot.
const MAX_429_BACKOFF: Duration = Duration::from_secs(15);
/// Observe-first depth probe reference notional from ADR-0028.
const DEPTH_PROBE_NOTIONAL_USD: f64 = 1_000.0;
/// If the price is unavailable, probe roughly 1,000 whole tokens.
const DEPTH_PROBE_FALLBACK_TOKENS: u128 = 1_000;
/// Minimum interval between depth probes for the same asset. The probe is
/// observe-first (collecting a distribution over ~2 weeks for calibration) so
/// per-tick resolution is unnecessary — one sample every ~15 minutes still
/// yields ~96/asset/day (~1,344 over the window), ample to build the
/// `priceImpactPct` distribution per asset.
///
/// The interval is deliberately LONG and the probes are deliberately NOT
/// staggered. The price leg already runs near the Jupiter keyless rate budget
/// (~0.75 q/s), so any *continuous* extra load (a staggered probe trickle)
/// keeps the limiter perpetually saturated → sustained 429s with no recovery
/// window (measured 2026-06-30: a 5-min staggered probe held the 429 rate at
/// ~0.19/s, vs ~0.10/s for the synchronized 5-min burst). A synchronized burst
/// every 15 min instead spends most of the window quiet, letting the token
/// bucket refill — fewer total 429s and well under the PeganaJupiterRateLimited
/// alert. (The durable fix for the underlying keyless ceiling is the keyed
/// Jupiter/Pyth cutover tracked before 2026-07-31.)
const DEPTH_PROBE_INTERVAL: Duration = Duration::from_secs(900);

/// Per-asset wall-clock timestamp of the most recent depth probe. A std Mutex is
/// used instead of tokio's because the guard is always dropped synchronously
/// (before any `.await`) — holding it only for a brief map read/update avoids
/// the `clippy::await_holding_lock` lint.
static LAST_PROBE: LazyLock<Mutex<HashMap<String, Instant>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Returns `true` when a depth probe should be issued for an asset.
///
/// * `last` – the instant of the previous probe, or `None` if never probed.
/// * `now`  – the current instant (passed in for testability; callers use
///   `Instant::now()`).
/// * `interval` – minimum gap between probes.
///
/// Extracted as a pure function so it can be unit-tested without touching the
/// global `LAST_PROBE` state or making network calls.
pub(crate) fn should_probe(last: Option<Instant>, now: Instant, interval: Duration) -> bool {
    match last {
        None => true,
        Some(t) => now.saturating_duration_since(t) >= interval,
    }
}

#[derive(Debug, Deserialize)]
struct QuoteResponse {
    #[serde(rename = "inAmount")]
    in_amount: String,
    #[serde(rename = "outAmount")]
    out_amount: String,
    #[serde(rename = "priceImpactPct", default)]
    price_impact_pct: Option<String>,
    #[serde(rename = "contextSlot", default)]
    #[allow(dead_code)]
    context_slot: Option<u64>,
    #[serde(rename = "routePlan", default)]
    route_plan: Vec<RouteStep>,
}

#[derive(Debug, Deserialize)]
struct RouteStep {
    #[serde(rename = "swapInfo")]
    swap_info: SwapInfo,
}

#[derive(Debug, Deserialize)]
struct SwapInfo {
    label: Option<String>,
}

/// SOL mint on Solana.
const SOL_MINT: &str = "So11111111111111111111111111111111111111112";
/// USDC mint on Solana.
const USDC_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/// USDT mint on Solana.
const USDT_MINT: &str = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

/// Resolve the numéraire's Jupiter mint AND its on-chain decimals together so
/// the two can never drift apart. Returns `None` for an unknown numéraire — the
/// caller MUST bail rather than assume a default scale (H11: a silent decimals
/// fallback would distort every discount computed in that numéraire).
fn numeraire_meta(numeraire: &str) -> Option<(&'static str, u32)> {
    match numeraire {
        "SOL" => Some((SOL_MINT, 9)),
        "USDC" => Some((USDC_MINT, 6)),
        "USDT" => Some((USDT_MINT, 6)),
        _ => None,
    }
}

/// Smallest market value we accept from a Jupiter quote. A route whose
/// liquidity has momentarily collapsed can return a near-zero `out_amount`
/// (e.g. `1` smallest-unit) that survives the `out_amt.is_zero()` guard yet
/// implies a sub-cent USD price for a ~$1 stable or ~$100 LST — that is missing
/// data, not a real price. Persisting it would poison the discount EWMA exactly
/// like the 2026-06-12 `out_amount = 0` incident, whose fix (engine `|d| < 1`)
/// only rejects the *exact* $0 boundary, not a near-zero one. The authoritative
/// plausibility filter still lives in the engine (`is_plausible_discount_sample`);
/// this is source-side defense-in-depth that mirrors dexscreener's `price > 0`
/// floor. 0.001 USD is far below any tracked asset's price in normal *or*
/// depegged operation (a real depeg leaves the asset worth something), so it
/// never suppresses a genuine event.
///
/// ASYMMETRY vs dexscreener, justified explicitly (not left to inference — audit
/// 2026-07-18): dexscreener ALSO enforces a NAV-relative premium ceiling (reject
/// market > NAV + 10%) because its thin Raydium pairs periodically print
/// garbage-HIGH premiums ($1.46/$2.34 vs ~$1.10 NAV). Jupiter aggregates DEEP
/// liquidity, so a garbage-high *economic* premium is far less likely, and the
/// engine's `is_plausible_discount_sample` clamp is the authoritative
/// economic-plausibility backstop for BOTH sources — a NAV-relative ceiling here
/// would be redundant. We keep the 0.001 floor plus a generous 1,000,000 USD
/// ABSOLUTE ceiling: no tracked asset trades anywhere near $1M, so this catches
/// only an egregiously corrupt route/overflow the economic clamp shouldn't have
/// to (defense-in-depth, not an economic filter).
fn is_plausible_market_usd(value_usd: Decimal) -> bool {
    value_usd >= Decimal::new(1, 3) && value_usd <= Decimal::from(1_000_000u32)
}

fn probe_units(price_usd: f64, decimals: u32, one_unit: u128) -> u128 {
    let fallback = one_unit.saturating_mul(DEPTH_PROBE_FALLBACK_TOKENS);
    if !price_usd.is_finite() || price_usd <= 0.0 {
        return fallback;
    }

    let scale = 10_f64.powi(i32::try_from(decimals).unwrap_or(i32::MAX));
    let units = (DEPTH_PROBE_NOTIONAL_USD / price_usd) * scale;
    if !units.is_finite() || units <= 0.0 {
        return fallback;
    }

    let rounded = units.round();
    if !rounded.is_finite() || rounded <= 0.0 {
        return fallback;
    }

    let sized = if rounded >= u128::MAX as f64 {
        u128::MAX
    } else {
        rounded as u128
    };
    sized.max(one_unit)
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    // Pre-filter to assets that actually use a Jupiter quote. Otherwise the
    // round-robin wastes tick slots on PythSpot/DexScreener-backed assets,
    // which inflates effective RPS and slows the assets that *do* need
    // Jupiter coverage.
    let assets: Vec<AssetConfig> = state
        .assets
        .assets
        .iter()
        .filter(|a| matches!(a.market, MarketStrategy::JupiterUsd { .. }))
        .cloned()
        .collect();
    if assets.is_empty() {
        warn!("no jupiter-backed assets — jupiter source idle");
        return Ok(());
    }

    let tick_ms = state
        .config
        .poll_tick_ms
        .or(state.assets.polling.jupiter_tick_ms)
        .unwrap_or(2_200);
    let concurrency = state.config.jupiter_max_concurrent.max(1).min(assets.len());

    let mut idx: usize = 0;
    let mut tick = interval(Duration::from_millis(tick_ms));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    info!(
        tick_ms,
        asset_count = assets.len(),
        concurrency,
        effective_rps = (concurrency as f64) / (tick_ms as f64 / 1000.0),
        "jupiter source ready · concurrent round-robin (pre-filtered)"
    );

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("jupiter source shutdown");
                return Ok(());
            }
        }

        // Pick the next `concurrency` assets in round-robin and fire all of
        // them concurrently. Per-asset 429 retries happen *inside* poll_one
        // so a single bursty asset can't stall the others sharing this tick.
        let mut futs = FuturesUnordered::new();
        for i in 0..concurrency {
            let asset = assets[(idx + i) % assets.len()].clone();
            let state_ref = state.clone();
            futs.push(async move {
                let result = poll_one(&state_ref, &asset).await;
                (asset.symbol, result)
            });
        }
        idx = idx.wrapping_add(concurrency);

        while let Some((sym, result)) = futs.next().await {
            match result {
                Ok(()) => {
                    metrics::counter!(
                        "pegana_jupiter_polls_total",
                        "asset" => sym,
                        "status" => "ok",
                    )
                    .increment(1);
                }
                Err(e) => {
                    warn!(asset = %sym, error = %e, "jupiter poll failed");
                    metrics::counter!(
                        "pegana_jupiter_polls_total",
                        "asset" => sym,
                        "status" => "error",
                    )
                    .increment(1);
                }
            }
        }
    }
}

/// Parse a `Retry-After` header (seconds form only — Jupiter doesn't use the
/// HTTP-date form). Clamps to MAX_429_BACKOFF.
fn parse_retry_after(resp: &reqwest::Response) -> Option<Duration> {
    let raw = resp.headers().get(reqwest::header::RETRY_AFTER)?;
    let s = raw.to_str().ok()?;
    let secs: u64 = s.trim().parse().ok()?;
    Some(Duration::from_secs(secs).min(MAX_429_BACKOFF))
}

async fn quote_exact_in(
    state: &AppState,
    asset_symbol: &str,
    input_mint: &str,
    output_mint: &str,
    amount: u128,
) -> Result<QuoteResponse> {
    let url = format!(
        "{}/swap/v1/quote?inputMint={}&outputMint={}&amount={}&slippageBps=50&swapMode=ExactIn",
        state.config.jupiter_api_url, input_mint, output_mint, amount
    );

    // Retry-on-429 loop. Other status codes bail immediately — they're either
    // permanent (4xx other than 429) or transient enough that we'd rather
    // pick them up next tick instead of holding this slot.
    let mut attempt: u32 = 0;
    loop {
        let req = state.http.get(&url);
        let req = if let Some(key) = &state.config.jupiter_api_key {
            req.header("x-api-key", key)
        } else {
            req
        };
        let resp = req.send().await?;
        let status = resp.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            metrics::counter!("pegana_jupiter_429_total").increment(1);
            if attempt >= MAX_429_RETRIES {
                anyhow::bail!("jupiter 429 after {} retries", attempt);
            }
            let wait = parse_retry_after(&resp).unwrap_or(DEFAULT_429_BACKOFF);
            debug!(asset = %asset_symbol, ?wait, attempt, "jupiter 429 · backing off");
            sleep(wait).await;
            attempt += 1;
            continue;
        }
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("jupiter http {status} · body={text}");
        }
        return Ok(resp.json().await?);
    }
}

async fn record_depth_probe(
    state: &AppState,
    asset: &AssetConfig,
    num_mint: &str,
    price_usd: f64,
    one_unit: u128,
) {
    // Throttle: skip this tick unless at least DEPTH_PROBE_INTERVAL has elapsed
    // since the last probe for this asset. The std Mutex guard is acquired,
    // checked, and updated — then DROPPED — before any .await, satisfying
    // clippy::await_holding_lock. The probe itself never fires more than once per
    // DEPTH_PROBE_INTERVAL (~15 minutes) per asset, keeping the extra Jupiter
    // quote volume small (synchronized burst + long recovery window).
    {
        let now = Instant::now();
        let mut map = LAST_PROBE.lock().expect("LAST_PROBE poisoned");
        let last = map.get(&asset.symbol).copied();
        if !should_probe(last, now, DEPTH_PROBE_INTERVAL) {
            return;
        }
        map.insert(asset.symbol.clone(), now);
    } // guard dropped here — no Mutex held across the .await below

    let using_fallback = !price_usd.is_finite() || price_usd <= 0.0;
    let amount = probe_units(price_usd, asset.decimals as u32, one_unit);
    if using_fallback {
        debug!(
            asset = %asset.symbol,
            price_usd,
            probe_units = amount,
            "jupiter depth probe using fallback notional"
        );
    }

    let quote = match quote_exact_in(state, &asset.symbol, &asset.mint, num_mint, amount).await {
        Ok(quote) => quote,
        Err(e) => {
            metrics::gauge!(
                "pegana_jupiter_depth_probe_route",
                "asset" => asset.symbol.clone(),
            )
            .set(0.0);
            debug!(
                asset = %asset.symbol,
                probe_units = amount,
                error = %e,
                "jupiter depth probe failed"
            );
            return;
        }
    };

    let has_out_amount = Decimal::from_str(&quote.out_amount)
        .map(|out_amount| !out_amount.is_zero())
        .unwrap_or(false);
    if quote.route_plan.is_empty() || !has_out_amount {
        metrics::gauge!(
            "pegana_jupiter_depth_probe_route",
            "asset" => asset.symbol.clone(),
        )
        .set(0.0);
        debug!(
            asset = %asset.symbol,
            probe_units = amount,
            route_steps = quote.route_plan.len(),
            out_amount = %quote.out_amount,
            "jupiter depth probe found no usable route"
        );
        return;
    }

    metrics::gauge!(
        "pegana_jupiter_depth_probe_route",
        "asset" => asset.symbol.clone(),
    )
    .set(1.0);

    match quote
        .price_impact_pct
        .as_deref()
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|impact| impact.is_finite())
    {
        Some(impact) => {
            metrics::gauge!(
                "pegana_jupiter_depth_probe_impact",
                "asset" => asset.symbol.clone(),
            )
            .set(impact);
        }
        None => {
            debug!(
                asset = %asset.symbol,
                probe_units = amount,
                price_impact_pct = ?quote.price_impact_pct,
                "jupiter depth probe missing priceImpactPct"
            );
        }
    }
}

async fn poll_one(state: &AppState, asset: &AssetConfig) -> Result<()> {
    let (numeraire, numeraire_feed) = match &asset.market {
        MarketStrategy::JupiterUsd {
            numeraire,
            numeraire_feed,
        } => (numeraire.clone(), numeraire_feed.clone()),
        // PythSpot / DexScreenerUsd assets are handled by their own
        // sources — Jupiter skips them.
        MarketStrategy::PythSpot { .. } | MarketStrategy::DexScreenerUsd => return Ok(()),
    };
    let (num_mint, numeraire_decimals) =
        numeraire_meta(&numeraire).with_context(|| format!("unknown numeraire {numeraire}"))?;

    // Quote 1 unit of the asset → numeraire.
    let one_unit: u128 = 10u128.pow(asset.decimals as u32);
    let quote = quote_exact_in(state, &asset.symbol, &asset.mint, num_mint, one_unit).await?;

    let in_amt = Decimal::from_str(&quote.in_amount)?;
    let out_amt = Decimal::from_str(&quote.out_amount)?;
    if in_amt.is_zero() {
        anyhow::bail!("zero inAmount");
    }
    if out_amt.is_zero() {
        // Jupiter can return an HTTP-200 quote with `outAmount = 0` when a route
        // momentarily has no liquidity. That is missing data, NOT a $0 price —
        // emitting it would store `market_usd = 0` → discount = 1.0 → a false
        // depeg. (2026-06-12: one such tick painted JupUSD CRITICAL for ~7.5min.)
        // Skip this tick; the next sane quote resumes. Mirrors dexscreener's
        // `price > 0` guard and the in_amount check above.
        debug!(asset = %asset.symbol, "jupiter zero outAmount — skip market tick (no liquidity)");
        metrics::counter!("pegana_jupiter_zero_out_total").increment(1);
        return Ok(());
    }

    // out_amt is in smallest unit of numeraire (lamports for SOL, μUSDC for USDC).
    // Convert effective rate per 1 LST unit, in numeraire decimal units.
    // numeraire_decimals was resolved alongside the mint (numeraire_meta) so the
    // scale can never silently default for an unknown numéraire — see H11.
    let numeraire_unit = Decimal::from(10u64.pow(numeraire_decimals));
    let rate_in_numeraire = out_amt / numeraire_unit; // numeraire per 1 asset

    // numeraire/USD from Pyth cache — present, non-zero, AND fresh. A stalled
    // publisher's frozen numéraire would otherwise poison a fresh-looking market
    // value (see state::fresh_numeraire).
    let numeraire_usd = match crate::state::fresh_numeraire(&state.pyth, &numeraire_feed).await {
        Some(v) => v,
        None => {
            debug!(asset = %asset.symbol, %numeraire_feed, "no fresh pyth numeraire — skip USD calc");
            return Ok(());
        }
    };
    // checked_mul (audit F-12): raw Decimal `*` panics on overflow. `numeraire_usd`
    // is an external Pyth price with no economic upper bound — skip the tick
    // cleanly on overflow rather than crash-loop the poll. (The is_plausible
    // sanity check below runs only AFTER this, so it can't guard the multiply.)
    let Some(value_usd) = rate_in_numeraire.checked_mul(numeraire_usd) else {
        debug!(asset = %asset.symbol, "numeraire × rate overflow — skip USD calc");
        return Ok(());
    };
    if !is_plausible_market_usd(value_usd) {
        // Near-zero (but non-zero) out_amount → sub-cent implied price = a
        // collapsed/illiquid route, not a $0.000x asset. Skip this tick; the
        // next sane quote resumes. Defense-in-depth beyond `out_amt.is_zero()`
        // and the engine's |d|<1 guard (2026-06-12 near-zero residual).
        debug!(
            asset = %asset.symbol,
            %value_usd,
            "jupiter implausibly-small market value — skip tick (degenerate route)"
        );
        metrics::counter!("pegana_jupiter_implausible_value_total").increment(1);
        return Ok(());
    }
    let price_usd = pegana_common::decimal_to_f64(value_usd);
    let price_impact = quote
        .price_impact_pct
        .as_deref()
        .and_then(|s| Decimal::from_str(s).ok());
    let route_label = quote
        .route_plan
        .first()
        .and_then(|r| r.swap_info.label.clone());
    let ts = chrono::Utc::now();

    sinks::postgres::insert_market(
        &state.pg,
        &asset.symbol,
        value_usd,
        &numeraire,
        Some(in_amt),
        Some(out_amt),
        price_impact,
        route_label.as_deref(),
        ts,
    )
    .await?;

    // When the quote is SOL-denominated we publish `value_sol` alongside
    // `value_usd`. LSTs in the engine prefer the SOL path because both
    // intrinsic and market share the same pyth(SOL/USD) multiplier, and
    // computing discount in SOL terms cancels the multiplier (eliminating
    // the synthetic-drift class of bugs). USDC/USDT-quoted assets don't
    // emit `value_sol` — for stables the USD path is already correct.
    let value_sol_opt = if numeraire == "SOL" {
        Some(rate_in_numeraire)
    } else {
        None
    };
    let payload = serde_json::json!({
        "asset": asset.symbol,
        "value_usd": value_usd,
        "value_sol": value_sol_opt,
        "numeraire": numeraire,
        "raw_in": quote.in_amount,
        "raw_out": quote.out_amount,
        "price_impact_pct": price_impact,
        "route_label": route_label,
        "ts": ts,
    });
    sinks::redis_pub::publish_tracked(
        state.redis.clone(),
        pegana_common::channels::SRC_JUPITER,
        &payload,
        "jupiter",
    )
    .await?;
    record_depth_probe(state, asset, num_mint, price_usd, one_unit).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_plausible_market_usd, probe_units, should_probe, DEPTH_PROBE_INTERVAL};
    use rust_decimal::Decimal;
    use std::str::FromStr;
    use std::time::{Duration, Instant};

    fn d(s: &str) -> Decimal {
        Decimal::from_str(s).unwrap()
    }

    #[test]
    fn rejects_near_zero_market_value() {
        // out_amount = 1 on a 6-dec numeraire → ~0.000001 USD. The exact-zero
        // guard misses this; the floor must catch it (2026-06-12 residual).
        assert!(!is_plausible_market_usd(d("0.000001")));
        assert!(!is_plausible_market_usd(Decimal::ZERO));
    }

    #[test]
    fn accepts_real_prices_including_depegs() {
        assert!(is_plausible_market_usd(d("1.0"))); // healthy stable
        assert!(is_plausible_market_usd(d("0.95"))); // mild depeg
        assert!(is_plausible_market_usd(d("0.05"))); // severe-but-real depeg
        assert!(is_plausible_market_usd(d("152.4"))); // LST priced in USD
    }

    #[test]
    fn floor_is_one_tenth_of_a_cent() {
        assert!(is_plausible_market_usd(d("0.001"))); // boundary inclusive
        assert!(!is_plausible_market_usd(d("0.0009")));
    }

    #[test]
    fn probe_units_sizes_roughly_one_thousand_usd() {
        assert_eq!(probe_units(1.0, 6, 1_000_000), 1_000_000_000);
        assert_eq!(probe_units(200.0, 9, 1_000_000_000), 5_000_000_000);
    }

    #[test]
    fn probe_units_falls_back_when_price_is_unavailable() {
        assert_eq!(probe_units(0.0, 6, 1_000_000), 1_000_000_000);
    }

    #[test]
    fn probe_units_never_drops_below_one_unit() {
        assert_eq!(probe_units(2_000.0, 6, 1_000_000), 1_000_000);
    }

    // ── should_probe unit tests ──────────────────────────────────────────────

    #[test]
    fn should_probe_returns_true_when_never_probed() {
        let now = Instant::now();
        assert!(should_probe(None, now, DEPTH_PROBE_INTERVAL));
    }

    #[test]
    fn should_probe_returns_false_when_probed_just_now() {
        let now = Instant::now();
        // last == now → elapsed == 0 < DEPTH_PROBE_INTERVAL → must NOT probe.
        assert!(!should_probe(Some(now), now, DEPTH_PROBE_INTERVAL));
    }

    #[test]
    fn should_probe_returns_false_before_interval_elapses() {
        let now = Instant::now();
        // 4 minutes elapsed out of the 15-minute interval — not yet due.
        let last = now
            .checked_sub(Duration::from_secs(240))
            .expect("time subtraction");
        assert!(!should_probe(Some(last), now, DEPTH_PROBE_INTERVAL));
    }

    #[test]
    fn should_probe_returns_true_after_interval_elapses() {
        let now = Instant::now();
        // Exactly DEPTH_PROBE_INTERVAL elapsed → edge is inclusive → must probe.
        let last = now
            .checked_sub(DEPTH_PROBE_INTERVAL)
            .expect("time subtraction");
        assert!(should_probe(Some(last), now, DEPTH_PROBE_INTERVAL));
    }

    #[test]
    fn should_probe_returns_true_well_past_interval() {
        let now = Instant::now();
        // Well past a 15-minute interval — clearly overdue.
        let last = now
            .checked_sub(Duration::from_secs(1800))
            .expect("time subtraction");
        assert!(should_probe(Some(last), now, DEPTH_PROBE_INTERVAL));
    }
}
