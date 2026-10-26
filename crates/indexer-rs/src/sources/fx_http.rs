//! Fiat FX rate (USD per 1 unit of a base currency) from free public venues,
//! for FX-pegged intrinsics (EURC → EUR/USD). Replaces `pyth_fx_cross`
//! `EUR/USD`, whose Pyth feed is not available on Solana without paid Hermes.
//!
//! Venues (keyless):
//!   - Kraken   `GET /0/public/Ticker?pair=EURUSD` → mid of best bid / ask.
//!   - Coinbase `GET /v2/exchange-rates?currency=EUR` → `data.rates.USD`.
//!
//! The published value is the MEDIAN of the venues that answered (with two
//! venues, their mean). When both answer they must agree within
//! `max_divergence_bps` (default 10 bps), otherwise nothing is published. A
//! single answering venue is NOT enough: an FX intrinsic from one unverified
//! HTTP source is refused, so EURC goes UNKNOWN (through the engine's normal
//! staleness gate) rather than pricing off an uncorroborated number.
//!
//! Forex weekend: spot FX does not trade from Friday ~21:00-22:00 UTC to Sunday
//! ~21:00-22:00 UTC. Crypto venues keep quoting EUR/USD over the weekend, but
//! that is a thin off-market print, not the reference rate. To keep the
//! previous (Pyth FX) behaviour honest and unchanged, this source does NOT
//! publish inside the buffered closed window (Fri 20:30 → Sun 22:30 UTC, the
//! same window as `web/lib/asset/forex.ts::isForexWeekend` and
//! `scripts/calibration-watch.sh`). The engine therefore freezes EURC exactly
//! as before and the web shows the calm "FX market closed" banner.

use crate::sources::nav_publish;
use crate::state::AppState;
use anyhow::{Context, Result};
use chrono::{DateTime, Datelike, Timelike, Utc, Weekday};
use pegana_common::IntrinsicStrategy;
use rust_decimal::Decimal;
use std::str::FromStr;
use std::time::Duration;
use tokio::time::{interval, sleep, MissedTickBehavior};
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

const DEFAULT_POLL_MS: u64 = 60_000;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_ATTEMPTS: u32 = 2;
const RETRY_BACKOFF: Duration = Duration::from_millis(750);

/// Friday close / Sunday reopen, minutes into the UTC day. Buffered around the
/// nominal 22:00 boundaries so both DST regimes are covered. MUST match
/// `web/lib/asset/forex.ts` (FRI_CLOSE_MIN / SUN_OPEN_MIN).
const FRI_CLOSE_MIN: u32 = 20 * 60 + 30;
const SUN_OPEN_MIN: u32 = 22 * 60 + 30;

/// Minimum venues that must answer (and agree) before a rate is published.
const MIN_VENUES: usize = 2;

/// Whether `now` falls inside the forex-closed weekend window (UTC): Friday
/// from 20:30, all of Saturday, Sunday before 22:30. Mirrors `isForexWeekend`.
pub fn is_forex_weekend(now: DateTime<Utc>) -> bool {
    let minutes = now.hour() * 60 + now.minute();
    match now.weekday() {
        Weekday::Sat => true,
        Weekday::Fri => minutes >= FRI_CLOSE_MIN,
        Weekday::Sun => minutes < SUN_OPEN_MIN,
        _ => false,
    }
}

/// Kraken pair code for a base/quote (e.g. EUR/USD → "EURUSD").
fn kraken_pair(base: &str, quote: &str) -> String {
    format!("{}{}", base.to_uppercase(), quote.to_uppercase())
}

/// Parse a Kraken `Ticker` response → mid of best ask (`a[0]`) and bid (`b[0]`).
pub fn parse_kraken(body: &serde_json::Value) -> Result<Decimal> {
    if let Some(errs) = body["error"].as_array() {
        anyhow::ensure!(errs.is_empty(), "kraken error: {errs:?}");
    }
    let result = body["result"]
        .as_object()
        .context("kraken result missing")?;
    anyhow::ensure!(
        result.len() == 1,
        "kraken result has {} pairs, expected 1",
        result.len()
    );
    let (_, t) = result.iter().next().context("kraken pair missing")?;
    let ask = Decimal::from_str(t["a"][0].as_str().context("kraken ask")?)?;
    let bid = Decimal::from_str(t["b"][0].as_str().context("kraken bid")?)?;
    anyhow::ensure!(
        bid > Decimal::ZERO && ask >= bid,
        "kraken book invalid: bid {bid} ask {ask}"
    );
    let sum = ask.checked_add(bid).context("kraken mid overflow")?;
    sum.checked_div(Decimal::TWO).context("kraken mid overflow")
}

/// Parse a Coinbase `exchange-rates?currency=BASE` response → rate for `quote`.
pub fn parse_coinbase(body: &serde_json::Value, base: &str, quote: &str) -> Result<Decimal> {
    let data = &body["data"];
    anyhow::ensure!(
        data["currency"].as_str() == Some(base),
        "coinbase currency {:?} != {base}",
        data["currency"]
    );
    let rate = data["rates"][quote]
        .as_str()
        .with_context(|| format!("coinbase rate {quote} missing"))?;
    let v = Decimal::from_str(rate).context("coinbase rate not decimal")?;
    anyhow::ensure!(v > Decimal::ZERO, "coinbase rate non-positive");
    Ok(v.round_dp(10))
}

/// Median of the venue quotes, gated on agreement.
pub fn median_rate(quotes: &[Decimal], max_divergence_bps: u32) -> Result<Decimal> {
    anyhow::ensure!(
        quotes.len() >= MIN_VENUES,
        "only {} FX venue(s) answered, need {MIN_VENUES}",
        quotes.len()
    );
    let mut q = quotes.to_vec();
    q.sort();
    let lo = q[0];
    let hi = q[q.len() - 1];
    let div = nav_publish::divergence_bps(lo, hi).context("FX divergence not computable")?;
    anyhow::ensure!(
        div <= Decimal::from(max_divergence_bps),
        "FX venues diverge by {} bps (> {max_divergence_bps} bps): low {lo}, high {hi}",
        div.round_dp(2)
    );
    let mid = q.len() / 2;
    let median = if q.len().is_multiple_of(2) {
        q[mid - 1]
            .checked_add(q[mid])
            .and_then(|sum| sum.checked_div(Decimal::TWO))
            .context("FX median overflow")?
    } else {
        q[mid]
    };
    // A USD-per-unit FX rate for a major fiat sits well inside [0.01, 100].
    anyhow::ensure!(
        median >= Decimal::new(1, 2) && median <= Decimal::from(100u32),
        "FX rate {median} implausible"
    );
    Ok(median)
}

async fn get_json(http: &reqwest::Client, url: &str) -> Result<serde_json::Value> {
    let mut last_err = None;
    for attempt in 0..MAX_ATTEMPTS {
        if attempt > 0 {
            sleep(RETRY_BACKOFF).await;
        }
        match http.get(url).timeout(REQUEST_TIMEOUT).send().await {
            Ok(r) if r.status().is_success() => {
                match nav_publish::read_json_capped(r, nav_publish::MAX_BODY_BYTES).await {
                    Ok(v) => return Ok(v),
                    Err(e) => last_err = Some(e),
                }
            }
            Ok(r) => last_err = Some(anyhow::anyhow!("http {}", r.status())),
            Err(e) => last_err = Some(anyhow::anyhow!("request: {e}")),
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow::anyhow!("no attempt made")))
}

#[derive(Debug, Clone)]
struct FxTarget {
    symbol: String,
    base: String,
    quote: String,
    max_divergence_bps: u32,
}

fn targets(state: &AppState) -> Vec<FxTarget> {
    state
        .assets
        .assets
        .iter()
        .filter(|a| a.active)
        .filter_map(|a| match &a.intrinsic {
            IntrinsicStrategy::FxHttpMedian {
                base,
                quote,
                max_divergence_bps,
            } => Some(FxTarget {
                symbol: a.symbol.clone(),
                base: base.clone(),
                quote: quote.clone(),
                max_divergence_bps: *max_divergence_bps,
            }),
            _ => None,
        })
        .collect()
}

pub async fn run(state: AppState, shutdown: CancellationToken) -> Result<()> {
    let targets = targets(&state);
    if targets.is_empty() {
        info!("no active fx_http_median assets: fx_http source idle");
        return Ok(());
    }
    let cadence_ms = std::env::var("FX_HTTP_POLL_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_POLL_MS);
    let mut tick = interval(Duration::from_millis(super::min_poll_ms(cadence_ms)));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let http = nav_publish::bounded_http_client()?;
    info!(cadence_ms, assets = targets.len(), "fx_http source ready");

    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = shutdown.cancelled() => {
                info!("fx_http source shutdown");
                return Ok(());
            }
        }
        let now = Utc::now();
        if is_forex_weekend(now) {
            debug!("forex weekend: FX intrinsic intentionally not published");
            metrics::counter!("pegana_fx_http_polls_total", "status" => "market_closed")
                .increment(1);
            continue;
        }
        for t in &targets {
            let status = match poll_once(&state, &http, t, now).await {
                Ok(()) => "ok",
                Err(e) => {
                    warn!(asset = %t.symbol, error = %e, "fx_http poll failed: not published");
                    "error"
                }
            };
            metrics::counter!("pegana_fx_http_polls_total", "status" => status).increment(1);
        }
    }
}

async fn poll_once(
    state: &AppState,
    http: &reqwest::Client,
    t: &FxTarget,
    now: DateTime<Utc>,
) -> Result<()> {
    let kraken_url = format!(
        "https://api.kraken.com/0/public/Ticker?pair={}",
        kraken_pair(&t.base, &t.quote)
    );
    let coinbase_url = format!(
        "https://api.coinbase.com/v2/exchange-rates?currency={}",
        t.base.to_uppercase()
    );
    let (k, c) = tokio::join!(get_json(http, &kraken_url), get_json(http, &coinbase_url));
    let kraken = k.and_then(|b| parse_kraken(&b));
    let coinbase = c.and_then(|b| parse_coinbase(&b, &t.base, &t.quote));
    if let Err(e) = &kraken {
        warn!(asset = %t.symbol, error = %e, "fx_http kraken failed");
    }
    if let Err(e) = &coinbase {
        warn!(asset = %t.symbol, error = %e, "fx_http coinbase failed");
    }
    let quotes: Vec<Decimal> = [kraken.as_ref().ok(), coinbase.as_ref().ok()]
        .into_iter()
        .flatten()
        .copied()
        .collect();
    let rate = median_rate(&quotes, t.max_divergence_bps)?;
    metrics::gauge!("pegana_fx_http_rate", "pair" => format!("{}/{}", t.base, t.quote))
        .set(pegana_common::decimal_to_f64(rate));

    let meta = serde_json::json!({
        "pair": format!("{}/{}", t.base, t.quote),
        "kraken_mid": kraken.ok(),
        "coinbase_rate": coinbase.ok(),
        "method": "median of Kraken ticker mid and Coinbase exchange-rates",
        "max_divergence_bps": t.max_divergence_bps,
    });
    nav_publish::publish_intrinsic(state, &t.symbol, rate, "fx_http", meta, None, now).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn d(s: &str) -> Decimal {
        Decimal::from_str(s).unwrap()
    }

    /// Recorded live 2026-10-21 ~00:08 UTC (Kraken truncated to the fields used).
    fn kraken_fixture() -> serde_json::Value {
        serde_json::json!({"error":[],"result":{"ZEURZUSD":{
            "a":["1.12354","266","266.000"],"b":["1.12351","33","33.000"],
            "c":["1.12351","16.40370000"],"o":"1.12353"}}})
    }

    fn coinbase_fixture() -> serde_json::Value {
        serde_json::json!({"data":{"currency":"EUR","rates":{
            "USD":"1.1234515526558057","GBP":"0.8612","BRL":"6.05"}}})
    }

    #[test]
    fn parses_recorded_kraken_and_coinbase() {
        assert_eq!(parse_kraken(&kraken_fixture()).unwrap(), d("1.123525"));
        assert_eq!(
            parse_coinbase(&coinbase_fixture(), "EUR", "USD").unwrap(),
            d("1.1234515527")
        );
        let k = parse_kraken(&kraken_fixture()).unwrap();
        let c = parse_coinbase(&coinbase_fixture(), "EUR", "USD").unwrap();
        let m = median_rate(&[k, c], 10).unwrap();
        assert_eq!(m.round_dp(5), d("1.12349"));
    }

    #[test]
    fn rejects_kraken_errors_and_bad_books() {
        let err = serde_json::json!({"error":["EQuery:Unknown asset pair"]});
        assert!(parse_kraken(&err).is_err());
        let crossed = serde_json::json!({"error":[],"result":{"X":{"a":["1.10"],"b":["1.20"]}}});
        assert!(parse_kraken(&crossed).is_err());
        let overflow = serde_json::json!({"error":[],"result":{"X":{
            "a":[Decimal::MAX.to_string()],"b":[Decimal::MAX.to_string()]}}});
        assert!(parse_kraken(&overflow).is_err());
    }

    #[test]
    fn rejects_coinbase_wrong_currency() {
        let wrong = serde_json::json!({"data":{"currency":"USD","rates":{"USD":"1"}}});
        assert!(parse_coinbase(&wrong, "EUR", "USD").is_err());
    }

    #[test]
    fn divergence_above_10_bps_is_rejected() {
        // 1.1235 vs 1.1250 ~ 13.3 bps.
        let e = median_rate(&[d("1.1235"), d("1.1250")], 10).unwrap_err();
        assert!(e.to_string().contains("diverge"), "{e}");
        // 1.1235 vs 1.1245 ~ 8.9 bps → ok.
        assert_eq!(
            median_rate(&[d("1.1235"), d("1.1245")], 10).unwrap(),
            d("1.1240")
        );
    }

    #[test]
    fn multiple_sources_are_required() {
        let e = median_rate(&[d("1.1235")], 10).unwrap_err();
        assert!(e.to_string().contains("need 2"), "{e}");
        assert!(median_rate(&[], 10).is_err());
    }

    /// Live smoke (network): `cargo test -p indexer-rs -- --ignored live_smoke`.
    #[tokio::test]
    #[ignore]
    async fn live_smoke_eur_usd() {
        let http = crate::sources::nav_publish::bounded_http_client().unwrap();
        let k = parse_kraken(
            &get_json(&http, "https://api.kraken.com/0/public/Ticker?pair=EURUSD")
                .await
                .unwrap(),
        )
        .unwrap();
        let c = parse_coinbase(
            &get_json(
                &http,
                "https://api.coinbase.com/v2/exchange-rates?currency=EUR",
            )
            .await
            .unwrap(),
            "EUR",
            "USD",
        )
        .unwrap();
        let m = median_rate(&[k, c], 10);
        println!(
            "LIVE FX kraken_mid={k} coinbase={c} median={m:?} weekend={}",
            is_forex_weekend(Utc::now())
        );
        assert!(m.is_ok());
    }

    #[test]
    fn forex_weekend_window_matches_web() {
        // 2026-10-23 is a Friday.
        let at = |day: u32, h: u32, m: u32| Utc.with_ymd_and_hms(2026, 10, day, h, m, 0).unwrap();
        assert!(!is_forex_weekend(at(23, 20, 29)));
        assert!(is_forex_weekend(at(23, 20, 30)));
        assert!(is_forex_weekend(at(24, 12, 0))); // Saturday
        assert!(is_forex_weekend(at(25, 22, 29))); // Sunday before reopen
        assert!(!is_forex_weekend(at(25, 22, 30)));
        assert!(!is_forex_weekend(at(21, 3, 0))); // Wednesday
    }
}
