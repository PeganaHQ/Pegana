//! Black-box integration tests for the `GET /v1/audit?state=…` server-side
//! filter shipped to close AC42. Mirrors the existing http_endpoints.rs
//! pattern — skipped when `PEGANA_INTEGRATION_API_BASE` is unset so CI
//! stays green on machines without the prod-local stack.
//!
//! Local run:
//!   PEGANA_INTEGRATION_API_BASE=http://localhost:8081 \
//!     cargo test -p api-rs --test audit_state_filter -- --nocapture
//!
//! The tests assume the audit index has at least one row of each state.
//! In a fresh dev DB (no alerts yet) the filter assertions become trivial
//! (empty array = empty array filtered) — that's still a meaningful
//! contract check (no panics, valid JSON, expected shape).

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
async fn index_no_filter_returns_array() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!("{base}/v1/audit?limit=10"))
        .send()
        .await
        .expect("audit index");
    assert_eq!(resp.status(), 200, "expected 200 OK");
    let body: Value = resp.json().await.expect("json");
    assert!(body.is_array(), "/v1/audit must return a JSON array");
    let arr = body.as_array().unwrap();
    // Each row must have the documented shape.
    for row in arr {
        assert!(row.get("id").is_some(), "row missing id");
        assert!(row.get("asset").is_some(), "row missing asset");
        assert!(row.get("to_state").is_some(), "row missing to_state");
        assert!(
            row.get("receipt_sha256").is_some(),
            "row missing receipt_sha256"
        );
    }
}

#[tokio::test]
async fn index_state_filter_narrows_to_target_state() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!("{base}/v1/audit?state=DEPEG&limit=50"))
        .send()
        .await
        .expect("audit index ?state=DEPEG");
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.expect("json");
    let arr = body.as_array().expect("array body");
    // Every returned row's to_state MUST be DEPEG (if any rows exist).
    for row in arr {
        let to_state = row.get("to_state").and_then(|v| v.as_str()).unwrap_or("");
        assert_eq!(
            to_state, "DEPEG",
            "?state=DEPEG returned a row with to_state={to_state}"
        );
    }
}

#[tokio::test]
async fn index_invalid_state_returns_400_with_structured_body() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!("{base}/v1/audit?state=GARBAGE&limit=10"))
        .send()
        .await
        .expect("audit index ?state=GARBAGE");
    assert_eq!(resp.status(), 400, "invalid state must yield 400");
    let body: Value = resp.json().await.expect("json error body");
    assert_eq!(
        body.get("error").and_then(|v| v.as_str()),
        Some("invalid_state"),
        "body.error must be 'invalid_state'"
    );
    assert!(
        body.get("valid")
            .and_then(|v| v.as_array())
            .is_some_and(|a| !a.is_empty()),
        "body.valid must be a non-empty array of accepted states"
    );
}

#[tokio::test]
async fn index_state_pegged_requires_exclude_pegged_false() {
    let Some(base) = base_url() else { return };
    // exclude_pegged defaults to true; explicitly filtering by PEGGED
    // without flipping it returns []. This double-check is the kind of
    // gotcha the AC42 documentation should make explicit.
    let resp = client()
        .get(format!("{base}/v1/audit?state=PEGGED&limit=10"))
        .send()
        .await
        .expect("audit index ?state=PEGGED (defaults)");
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.expect("json");
    assert!(
        body.as_array().is_some_and(|a| a.is_empty()),
        "?state=PEGGED with exclude_pegged=true (default) must be empty"
    );

    let resp2 = client()
        .get(format!(
            "{base}/v1/audit?state=PEGGED&exclude_pegged=false&limit=10"
        ))
        .send()
        .await
        .expect("audit index ?state=PEGGED&exclude_pegged=false");
    assert_eq!(resp2.status(), 200);
    let body2: Value = resp2.json().await.expect("json");
    let arr = body2.as_array().expect("array");
    for row in arr {
        let to_state = row.get("to_state").and_then(|v| v.as_str()).unwrap_or("");
        assert_eq!(to_state, "PEGGED");
    }
}
