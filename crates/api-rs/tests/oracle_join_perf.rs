//! Regression guard for the 2026-07-25 incident: the single-asset detail
//! endpoint `GET /v1/assets/{symbol}` hung for 76-93s on DEX-priced USD
//! stables that carry an EMPTY `pyth_feed_id` (e.g. eUSX). The oracle asof
//! `o` LATERAL in `fetch_card` searched `oracle_snapshots.feed_id = ''` — a
//! value that never exists — and seq-scanned the 90-day hypertable. The fix
//! guards the leg with `NULLIF(lower(replace(pyth_feed_id,'0x','')),'')
//! IS NOT NULL` so empty/placeholder feeds skip the join entirely.
//!
//! The FIX is output-identical (an empty-feed asset had `oracle_degraded`
//! absent before AND after — only the latency changed), so the only faithful
//! assertion is latency + the absent-leg contract. This test therefore hits a
//! live backend and asserts the endpoint returns FAST. It self-skips when
//! `PEGANA_INTEGRATION_API_BASE` is unset, exactly like `http_endpoints.rs`,
//! so CI stays green without the prod-local stack.
//!
//! Local run:
//!   PEGANA_INTEGRATION_API_BASE=http://localhost:8081 \
//!     cargo test -p api-rs --test oracle_join_perf -- --nocapture

use serde_json::Value;
use std::time::{Duration, Instant};

fn base_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_API_BASE")
        .ok()
        .filter(|s| !s.is_empty())
}

/// A generous-but-bounded budget. The fixed endpoint answers in <1s; the
/// pre-fix bug answered in 76-93s. 15s cleanly separates the two: a regression
/// trips the client timeout and fails, a healthy build passes with wide margin.
fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .expect("build reqwest client")
}

/// Canonical incident asset: a `jupiter_usd`, USD-peg stable with an empty
/// `pyth_feed_id` — the exact profile that triggered the seq-scan.
const EMPTY_FEED_ASSET: &str = "eUSX";

#[tokio::test]
async fn empty_feed_asset_detail_is_fast_and_omits_oracle_leg() {
    let Some(base) = base_url() else {
        eprintln!("skipping: PEGANA_INTEGRATION_API_BASE unset");
        return;
    };
    let url = format!("{base}/v1/assets/{EMPTY_FEED_ASSET}");

    let started = Instant::now();
    let resp = client()
        .get(&url)
        .send()
        .await
        .unwrap_or_else(|e| panic!("request to {url} failed (a timeout here means the oracle-join seq-scan regressed): {e}"));
    let elapsed = started.elapsed();

    // The asset must exist in this DB for the guard to be meaningful; a 404
    // means the local universe differs — skip rather than false-fail.
    if resp.status().as_u16() == 404 {
        eprintln!("skipping: {EMPTY_FEED_ASSET} not present in this DB (404)");
        return;
    }
    assert!(
        resp.status().is_success(),
        "{url} -> HTTP {} (expected 2xx)",
        resp.status()
    );

    // Hard perf gate: pre-fix this was 76-93s; fixed it is <1s. Anything over
    // 10s means the empty-feed oracle join is scanning again.
    assert!(
        elapsed < Duration::from_secs(10),
        "{url} took {elapsed:?} — empty-feed oracle-join seq-scan appears to have regressed (was 76-93s before the NULLIF guard)"
    );

    let body: Value = resp.json().await.expect("detail response is JSON");
    // Sanity: it really is the detail card, not an error envelope.
    assert_eq!(
        body.get("symbol").and_then(|s| s.as_str()),
        Some(EMPTY_FEED_ASSET),
        "detail card must echo the requested symbol: {body}"
    );
    // Contract: an empty-feed asset has NO oracle leg, so the advisory
    // `oracle_degraded` annotation is omitted entirely (never null).
    assert!(
        body.get("oracle_degraded").is_none(),
        "empty-feed asset must omit oracle_degraded (no oracle feed configured): {body}"
    );
}
