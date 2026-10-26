//! Black-box integration tests for the tokens.xyz signal-out feed.
//!
//! Skipped when `PEGANA_INTEGRATION_API_BASE` is unset — same gating as
//! `http_endpoints.rs`, so CI without the prod-local docker stack stays green.
//!
//! Local run:
//!   PEGANA_INTEGRATION_API_BASE=http://localhost:8081 \
//!     cargo test -p api-rs --test peg_feed -- --nocapture

use serde_json::Value;
use std::time::Duration;

fn base_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_API_BASE")
        .ok()
        .filter(|s| !s.is_empty())
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("build reqwest client")
}

#[tokio::test]
async fn batch_feed_is_array_and_resolvable() {
    let Some(base) = base_url() else { return };
    let body: Value = client()
        .get(format!("{base}/v1/peg/feed"))
        .send()
        .await
        .expect("feed")
        .json()
        .await
        .expect("feed json");
    assert_eq!(body["ok"], true);
    assert!(body["count"].as_u64().unwrap() >= 1);
    // methodology is stamped once on the batch envelope, not per signal.
    assert!(body["methodology"].is_string());
    // `data` is an ARRAY; each signal carries its own `mint`.
    let data = body["data"].as_array().unwrap();
    let first = &data[0];
    let mint = first["mint"].as_str().expect("signal carries mint");
    // The per-mint endpoint is a single resource → returns the bare signal (same
    // shape as one element of the batch `data[]`).
    let one: Value = client()
        .get(format!("{base}/v1/peg/feed/by-mint/{mint}"))
        .send()
        .await
        .expect("by-mint")
        .json()
        .await
        .expect("by-mint json");
    assert_eq!(one["symbol"], first["symbol"]);
    assert_eq!(one["mint"], mint);
    // Honesty fields present on every row.
    assert!(first["calibration"].is_string());
    assert!(first["monitoring_only"].is_boolean());
    assert!(first["receipt_url"].is_string());
    // methodology is NOT repeated per signal (it's on the envelope).
    assert!(first.get("methodology").is_none());
}

#[tokio::test]
async fn unknown_mint_is_404_json() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!(
            "{base}/v1/peg/feed/by-mint/NotARealMint11111111111111111111111111111"
        ))
        .send()
        .await
        .expect("by-mint");
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.expect("404 json");
    assert_eq!(body["error"], "unknown_asset");
}

#[tokio::test]
async fn feed_allows_cross_origin() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!("{base}/v1/peg/feed"))
        .header("Origin", "https://app.tokens.xyz")
        .send()
        .await
        .expect("feed cors");
    assert_eq!(
        resp.headers()
            .get("access-control-allow-origin")
            .and_then(|v| v.to_str().ok()),
        Some("https://app.tokens.xyz")
    );
}

#[tokio::test]
async fn feed_supports_conditional_get_304() {
    let Some(base) = base_url() else { return };
    let c = client();
    let first = c
        .get(format!("{base}/v1/peg/feed"))
        .send()
        .await
        .expect("feed");
    let etag = first
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let Some(etag) = etag else {
        panic!("feed must set an ETag");
    };
    let second = c
        .get(format!("{base}/v1/peg/feed"))
        .header("If-None-Match", etag)
        .send()
        .await
        .expect("feed conditional");
    assert_eq!(second.status(), 304);
}
