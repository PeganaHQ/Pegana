//! Shared write path for the free off-Pyth intrinsic sources
//! (`jupiter_perps`, `evm_nav`, `fx_http`).
//!
//! Every reading goes to `intrinsic_snapshots` first (the audit trail), then to
//! the generic `SRC_INTRINSIC` Redis channel as `{asset, value_usd, source,
//! meta, ts}`, the same envelope shape the engine already consumes from the
//! Sanctum / Solayer / Piggybank / Perena channels.

use crate::sinks;
use crate::state::AppState;
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;

/// Largest response body the free HTTP sources (`evm_nav`, `fx_http`) accept.
/// Their real payloads are small (Coinbase exchange-rates ~25 KB, Kraken
/// ticker ~0.3 KB, an `eth_call` batch well under 1 KB, measured 2026-10-22),
/// so 64 KB bounds memory against a misbehaving or hostile upstream with
/// headroom for growth.
pub const MAX_BODY_BYTES: usize = 64 * 1024;

/// HTTP client for the free NAV / FX sources: redirects disabled (an
/// upstream must answer at the URL we configured, never bounce us elsewhere),
/// plus the indexer's usual user agent and a 15s ceiling.
pub fn bounded_http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("pegana-indexer/0.1")
        .build()
        .context("build bounded HTTP client")
}

/// Read a JSON body of at most `max` bytes. A declared `Content-Length` over
/// the cap is refused before reading; otherwise the body is read chunk by
/// chunk and refused as soon as it passes the cap.
pub async fn read_json_capped(
    mut resp: reqwest::Response,
    max: usize,
) -> Result<serde_json::Value> {
    if let Some(len) = resp.content_length() {
        anyhow::ensure!(
            len <= max as u64,
            "response body {len} bytes exceeds the {max}-byte cap"
        );
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.context("read body")? {
        anyhow::ensure!(
            buf.len() + chunk.len() <= max,
            "response body exceeds the {max}-byte cap"
        );
        buf.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&buf).context("decode body")
}

/// Persist and publish one intrinsic reading.
///
/// `source` is both the `intrinsic_snapshots.source` value and the
/// `pegana_source_last_publish_timestamp{source}` liveness label.
pub async fn publish_intrinsic(
    state: &AppState,
    asset: &str,
    value_usd: Decimal,
    source: &'static str,
    meta: serde_json::Value,
    slot: Option<i64>,
    ts: DateTime<Utc>,
) -> Result<()> {
    sinks::postgres::insert_intrinsic(&state.pg, asset, value_usd, source, meta.clone(), slot, ts)
        .await
        .with_context(|| format!("insert intrinsic snapshot for {asset}"))?;

    let payload = serde_json::json!({
        "asset": asset,
        "value_usd": value_usd,
        "source": source,
        "meta": meta,
        "ts": ts,
    });
    sinks::redis_pub::publish_tracked(
        state.redis.clone(),
        pegana_common::channels::SRC_INTRINSIC,
        &payload,
        source,
    )
    .await
    .with_context(|| format!("publish intrinsic for {asset}"))?;
    Ok(())
}

/// Relative divergence between two positive readings, in basis points of
/// their mean. `None` when either value is non-positive or the arithmetic
/// overflows (callers treat `None` as "cannot verify agreement").
pub fn divergence_bps(a: Decimal, b: Decimal) -> Option<Decimal> {
    if a <= Decimal::ZERO || b <= Decimal::ZERO {
        return None;
    }
    let mean = a.checked_add(b)?.checked_div(Decimal::TWO)?;
    (a - b)
        .abs()
        .checked_div(mean)?
        .checked_mul(Decimal::from(10_000u32))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn d(s: &str) -> Decimal {
        Decimal::from_str(s).unwrap()
    }

    #[test]
    fn divergence_is_symmetric_and_in_bps_of_mean() {
        let x = divergence_bps(d("1.0000"), d("1.0010")).unwrap();
        let y = divergence_bps(d("1.0010"), d("1.0000")).unwrap();
        assert_eq!(x, y);
        // 0.001 / 1.0005 * 10_000 ~= 9.995 bps
        assert!(x > d("9.99") && x < d("10.0"), "{x}");
        assert_eq!(divergence_bps(d("1.5"), d("1.5")), Some(Decimal::ZERO));
    }

    #[test]
    fn divergence_rejects_non_positive_inputs() {
        assert_eq!(divergence_bps(Decimal::ZERO, d("1")), None);
        assert_eq!(divergence_bps(d("1"), d("-1")), None);
    }
}

#[cfg(test)]
mod http_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// One-shot local HTTP server answering every request with `response`.
    async fn serve(response: Vec<u8>) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                let mut req = [0u8; 2048];
                let _ = sock.read(&mut req).await;
                let _ = sock.write_all(&response).await;
                let _ = sock.shutdown().await;
            }
        });
        format!("http://{addr}/")
    }

    fn http_ok(body: &[u8], with_len: bool) -> Vec<u8> {
        let mut r =
            b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nconnection: close\r\n".to_vec();
        if with_len {
            r.extend_from_slice(format!("content-length: {}\r\n", body.len()).as_bytes());
        }
        r.extend_from_slice(b"\r\n");
        r.extend_from_slice(body);
        r
    }

    #[tokio::test]
    async fn body_cap_and_no_redirects() {
        let http = bounded_http_client().unwrap();

        // Small body: decoded.
        let url = serve(http_ok(br#"{"ok":1}"#, true)).await;
        let v = read_json_capped(http.get(&url).send().await.unwrap(), MAX_BODY_BYTES)
            .await
            .unwrap();
        assert_eq!(v["ok"], 1);

        // Declared length over the cap: refused before reading.
        let big = format!("{{\"x\":\"{}\"}}", "a".repeat(MAX_BODY_BYTES + 10));
        let url = serve(http_ok(big.as_bytes(), true)).await;
        let err = read_json_capped(http.get(&url).send().await.unwrap(), MAX_BODY_BYTES)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("cap"), "{err}");

        // No content-length (read until close): refused while streaming.
        let url = serve(http_ok(big.as_bytes(), false)).await;
        let err = read_json_capped(http.get(&url).send().await.unwrap(), MAX_BODY_BYTES)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("cap"), "{err}");

        // A redirect is returned as-is, never followed.
        let target = serve(http_ok(br#"{"followed":true}"#, true)).await;
        let redirect = format!(
            "HTTP/1.1 302 Found\r\nlocation: {target}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
        );
        let url = serve(redirect.into_bytes()).await;
        let resp = http.get(&url).send().await.unwrap();
        assert_eq!(resp.status().as_u16(), 302, "redirect must not be followed");
    }
}
