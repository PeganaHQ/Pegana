use anyhow::{bail, Context, Result};
use rust_decimal::Decimal;
use serde::Deserialize;

/// One parsed candle. The backtest uses the close as its tick price.
#[derive(Debug, Clone)]
pub struct Candle {
    pub t: i64,
    pub close: Decimal,
}

#[derive(Deserialize)]
struct HistoryRaw {
    s: String,
    #[serde(default)]
    t: Vec<i64>,
    #[serde(default)]
    c: Vec<f64>,
    #[serde(default)]
    errmsg: Option<String>,
}

/// Parse the Pyth Benchmarks TradingView shim response without network access.
pub fn parse_history(body: &str) -> Result<Vec<Candle>> {
    let raw: HistoryRaw = serde_json::from_str(body).context("parse benchmarks history")?;
    if raw.s != "ok" {
        bail!("benchmarks status={} err={:?}", raw.s, raw.errmsg);
    }
    if raw.t.len() != raw.c.len() {
        bail!("t/c length mismatch: {} vs {}", raw.t.len(), raw.c.len());
    }

    raw.t
        .into_iter()
        .zip(raw.c)
        .map(|(t, close)| {
            Ok(Candle {
                t,
                close: format!("{close:.8}")
                    .parse()
                    .context("close to Decimal")
                    .map(|value: Decimal| value.normalize())?,
            })
        })
        .collect()
}

/// Fetch one feed's candles. Network access is restricted to capture mode.
pub async fn fetch_history(
    symbol: &str,
    resolution: &str,
    from: i64,
    to: i64,
) -> Result<Vec<Candle>> {
    const URL: &str = "https://benchmarks.pyth.network/v1/shims/tradingview/history";
    let client = reqwest::Client::builder().build()?;

    for attempt in 1..=5 {
        let response = client
            .get(URL)
            .query(&[
                ("symbol", format!("Crypto.{symbol}")),
                ("resolution", resolution.to_owned()),
                ("from", from.to_string()),
                ("to", to.to_string()),
            ])
            .send()
            .await;
        let response = match response {
            Ok(response) => response,
            Err(_) if attempt < 5 => {
                tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                continue;
            }
            Err(error) => {
                return Err(error).with_context(|| {
                    format!("GET benchmarks history for {symbol} after {attempt} attempts")
                });
            }
        };
        let status = response.status();
        if status.is_success() {
            return parse_history(&response.text().await?);
        }
        if attempt == 5 {
            bail!("benchmarks {symbol} after {attempt} attempts: {status}");
        }
        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
    }

    unreachable!("bounded retry loop always returns")
}
