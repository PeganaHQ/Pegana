//! Black-box integration tests against a running api-rs HTTP server.
//!
//! These tests assert the public REST contract end-to-end: routes wire to
//! handlers, handlers query Postgres + Redis, payload shapes match what the
//! web client expects, and the live pipeline keeps `updated_at` fresh.
//!
//! Skipped when `PEGANA_INTEGRATION_API_BASE` is unset — that's how CI stays
//! green on machines without the prod-local docker stack running.
//!
//! Local run:
//!   PEGANA_INTEGRATION_API_BASE=http://localhost:8081 \
//!     cargo test -p api-rs --test http_endpoints -- --nocapture

use chrono::{DateTime, Utc};
use serde_json::Value;
use std::time::Duration;

/// Required env var. Set to `http://localhost:8081` against the prod-local
/// stack; CI leaves it empty and every test below short-circuits.
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

/// Assert the uniform list envelope and return its `data` array.
///
/// Every `/v1` list endpoint returns `{ ok:true, generated_at, count, data:[…] }`
/// (never a bare array). This centralises the envelope contract for the
/// integration suite: it checks `ok:true`, a parseable RFC3339 `generated_at`,
/// and that `count` equals `data.len()`, then hands back `data` so each test
/// asserts row shape exactly as it did against the pre-envelope bare array.
fn unwrap_list(v: Value) -> Vec<Value> {
    assert_eq!(
        v.get("ok").and_then(|x| x.as_bool()),
        Some(true),
        "list envelope must carry ok:true — got {v}"
    );
    assert!(
        v.get("generated_at")
            .and_then(|x| x.as_str())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .is_some(),
        "list envelope must carry an RFC3339 generated_at — got {v}"
    );
    let data = v
        .get("data")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_else(|| panic!("list envelope must carry a data array — got {v}"));
    assert_eq!(
        v.get("count").and_then(|x| x.as_u64()),
        Some(data.len() as u64),
        "list envelope count must equal data.len() — got {v}"
    );
    data
}

#[tokio::test]
async fn healthz_returns_ok() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!("{base}/healthz"))
        .send()
        .await
        .expect("healthz");
    assert_eq!(resp.status(), 200, "healthz must be 200");
    let body = resp.text().await.expect("body");
    assert!(body.contains("ok") || body.contains("OK"), "got: {body}");
}

/// `/health` is an alias for `/healthz`. Uptime monitors, load balancers, and
/// k8s liveness probes default to `/health`, which used to 404 (Gecko API
/// report 2026-06-10).
#[tokio::test]
async fn health_alias_returns_ok() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!("{base}/health"))
        .send()
        .await
        .expect("health");
    assert_eq!(resp.status(), 200, "/health alias must be 200, not 404");
    let body = resp.text().await.expect("body");
    assert!(body.contains("ok") || body.contains("OK"), "got: {body}");
}

/// A missing required query param must reject with the JSON error envelope, not
/// axum's bare `text/plain` "Failed to deserialize query string" — the "dead
/// end" the Gecko API report (2026-06-10) flagged on `/v1/audit.csv`.
#[tokio::test]
async fn audit_csv_missing_param_is_json_error() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!("{base}/v1/audit.csv"))
        .send()
        .await
        .expect("audit.csv");
    assert_eq!(resp.status(), 400, "missing `from` must be 400");
    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_string();
    assert!(
        ct.contains("application/json"),
        "error body must be JSON, got content-type: {ct}"
    );
    let v: Value = resp.json().await.expect("json error body");
    assert_eq!(
        v.get("error").and_then(|x| x.as_str()),
        Some("invalid_query")
    );
    assert!(v.get("message").is_some(), "must carry a message");
}

#[tokio::test]
async fn stats_returns_expected_shape() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!("{base}/v1/stats"))
        .send()
        .await
        .expect("stats");
    assert_eq!(resp.status(), 200);
    let v: Value = resp.json().await.expect("stats json");

    let tracked = v
        .get("assets_tracked")
        .and_then(|x| x.as_u64())
        .expect("assets_tracked");
    assert!(
        tracked >= 14,
        "expected >= 14 tracked assets, got {tracked}"
    );

    assert!(v.get("alerts_24h").is_some(), "alerts_24h must be present");

    let by_state = v
        .get("by_state")
        .and_then(|x| x.as_object())
        .expect("by_state object");
    let pegged = by_state.get("PEGGED").and_then(|x| x.as_u64()).unwrap_or(0);
    let drift = by_state.get("DRIFT").and_then(|x| x.as_u64()).unwrap_or(0);
    assert!(
        pegged + drift > 0,
        "expected at least one PEGGED or DRIFT asset; by_state = {by_state:?}"
    );
}

#[tokio::test]
async fn assets_list_has_canonical_universe() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!("{base}/v1/assets"))
        .send()
        .await
        .expect("assets");
    assert_eq!(resp.status(), 200);
    let list = unwrap_list(resp.json().await.expect("assets envelope"));
    assert!(
        list.len() >= 14,
        "expected >= 14 assets, got {}",
        list.len()
    );

    let symbols: Vec<&str> = list
        .iter()
        .filter_map(|a| a.get("symbol").and_then(|s| s.as_str()))
        .collect();
    for required in ["jitoSOL", "mSOL", "bSOL", "hyUSD"] {
        assert!(
            symbols.contains(&required),
            "missing canonical asset {required}"
        );
    }

    // Every row must carry the contract the web client deserializes.
    for a in &list {
        for field in ["symbol", "class", "peg_target", "decimals", "mint"] {
            assert!(a.get(field).is_some(), "asset missing {field}: {a}");
        }
    }
}

/// Regression guard for the sol_per_lst + confidence serializer (2026-06-03).
/// A dropped `::numeric` cast or a silent `try_get(...).ok()` decode-mismatch
/// would null the field with no error (review MED-2), so this asserts the
/// POSITIVE shape: an LST exposes a string-decimal `sol_per_lst`, a non-LST
/// OMITS the key (skip_serializing_if), and `confidence` (when present) is a
/// documented bucket.
#[tokio::test]
async fn assets_expose_sol_per_lst_and_confidence() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!("{base}/v1/assets"))
        .send()
        .await
        .expect("assets");
    assert_eq!(resp.status(), 200);
    let list = unwrap_list(resp.json().await.expect("assets envelope"));

    let find = |sym: &str| {
        list.iter()
            .find(|a| a.get("symbol").and_then(|s| s.as_str()) == Some(sym))
            .cloned()
    };

    // An LST: sol_per_lst present, serialized as a string, parses to a positive
    // SOL/share. (Strict — a silent None from a broken cast would fail here.)
    let lst = find("jitoSOL").expect("jitoSOL in universe");
    let spl = lst
        .get("sol_per_lst")
        .and_then(|x| x.as_str())
        .expect("LST jitoSOL must expose sol_per_lst as a JSON string");
    let n: f64 = spl.parse().expect("sol_per_lst must parse as a decimal");
    assert!(
        n > 0.0,
        "sol_per_lst should be a positive SOL/share, got {spl}"
    );

    // confidence, when present, is one of the documented buckets.
    if let Some(c) = lst.get("confidence").and_then(|x| x.as_str()) {
        assert!(
            matches!(c, "high" | "medium" | "low" | "unknown"),
            "unexpected confidence bucket {c}"
        );
    }

    // A non-LST fiat stable must OMIT sol_per_lst (skip_serializing_if).
    if let Some(usdc) = find("USDC") {
        assert!(
            usdc.get("sol_per_lst").is_none(),
            "non-LST USDC must omit sol_per_lst, got {usdc}"
        );
    }
}

#[tokio::test]
async fn asset_state_includes_required_fields() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!("{base}/v1/assets/jitoSOL/state"))
        .send()
        .await
        .expect("state");
    assert_eq!(resp.status(), 200);
    // BONUS-cache: the 200 carries the short shared cache header (max-age=3,
    // tighter than detail's 5 because /state has no 15-min freshness bound).
    let cache = resp
        .headers()
        .get("cache-control")
        .and_then(|h| h.to_str().ok())
        .map(str::to_owned);
    assert_eq!(
        cache.as_deref(),
        Some("public, max-age=3, stale-while-revalidate=10"),
        "state 200 must carry the cache-control header"
    );
    let v: Value = resp.json().await.expect("state json");
    // Six legacy keys — the additive contract embed.js + the marketing embed
    // depend on (they read state/peg_state/discount and ignore unknown keys).
    for key in [
        "asset",
        "state",
        "since",
        "discount",
        "intrinsic_usd",
        "market_usd",
    ] {
        assert!(v.get(key).is_some(), "legacy key `{key}` missing: {v}");
    }
    assert_eq!(v.get("asset").and_then(|x| x.as_str()), Some("jitoSOL"));
    assert!(v.get("state").and_then(|x| x.as_str()).is_some());
    // P3: updated_at is a non-null RFC3339 string; stale is a JSON bool.
    assert!(
        v.get("updated_at").and_then(|x| x.as_str()).is_some(),
        "P3: updated_at must be a non-null RFC3339 string: {v}"
    );
    assert!(
        v.get("stale").and_then(|x| x.as_bool()).is_some(),
        "P3: stale must be a JSON bool: {v}"
    );
}

#[tokio::test]
async fn asset_history_returns_descending_series() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!(
            "{base}/v1/assets/jitoSOL/history?bucket=1m&limit=10"
        ))
        .send()
        .await
        .expect("history");
    assert_eq!(resp.status(), 200);
    let series = unwrap_list(resp.json().await.expect("history envelope"));
    assert!(!series.is_empty(), "expected at least one history bucket");

    // The API documents history as newest-first; assert non-increasing ts.
    let timestamps: Vec<DateTime<Utc>> = series
        .iter()
        .filter_map(|s| s.get("ts").and_then(|t| t.as_str()))
        .filter_map(|t| t.parse().ok())
        .collect();
    for w in timestamps.windows(2) {
        assert!(w[0] >= w[1], "history not sorted desc: {} < {}", w[0], w[1]);
    }
}

/// `/v1/calibration` is a list endpoint — assert its envelope + per-row contract
/// end-to-end (the openapi test pins the schema and a unit test pins the wrapper,
/// but nothing else exercised the live HTTP round-trip). Newest reshape: the body
/// is `{ ok, generated_at, count, data:[…] }`, each row a `CalibrationHealth`.
#[tokio::test]
async fn calibration_returns_enveloped_health_rows() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!("{base}/v1/calibration"))
        .send()
        .await
        .expect("calibration");
    assert_eq!(resp.status(), 200);
    // 30s shared cache header (mirrors the handler).
    assert_eq!(
        resp.headers()
            .get("cache-control")
            .and_then(|h| h.to_str().ok()),
        Some("public, max-age=30, stale-while-revalidate=60"),
    );
    let rows = unwrap_list(resp.json().await.expect("calibration envelope"));
    // One row per active asset; assert the contract on whatever rows exist.
    for r in &rows {
        for key in ["symbol", "monitoring_only", "calibration", "health"] {
            assert!(r.get(key).is_some(), "calibration row missing `{key}`: {r}");
        }
        // `health` is a closed set; `calibration` is the provisional|calibrated label.
        let health = r.get("health").and_then(|x| x.as_str()).unwrap_or("");
        assert!(
            matches!(health, "ok" | "watch" | "miscalibrated" | "no_data" | "na"),
            "unexpected health `{health}`: {r}"
        );
        assert!(matches!(
            r.get("calibration").and_then(|x| x.as_str()),
            Some("provisional") | Some("calibrated")
        ));
    }
}

#[tokio::test]
async fn asset_detail_unknown_symbol_returns_404() {
    let Some(base) = base_url() else { return };
    // Resource endpoint — unknown symbol must 404 (not 200 with empty).
    // Confirms axum router and assets.rs handler agree on the negative
    // path the web client branches on (404 → "not in universe" message).
    let resp = client()
        .get(format!("{base}/v1/assets/NOT_A_REAL_ASSET_XYZ_2026"))
        .send()
        .await
        .expect("asset detail unknown");
    assert_eq!(resp.status(), 404, "expected 404 for bogus symbol");
    // BONUS-cache: the cache-control header attaches only on the Ok path, so a
    // 404 must NOT be cached (else a transient miss could be served stale).
    assert!(
        resp.headers().get("cache-control").is_none(),
        "404 must NOT carry a cache-control header"
    );
    // P4: the error body is the JSON envelope {error, message, asset?}, not
    // plain text; an unknown symbol on detail maps to `unknown_asset`.
    let ct = resp
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_owned();
    assert!(
        ct.starts_with("application/json"),
        "P4: 404 body must be JSON, got content-type `{ct}`"
    );
    let body: Value = resp.json().await.expect("404 JSON envelope");
    assert_eq!(
        body.get("error").and_then(|x| x.as_str()),
        Some("unknown_asset"),
        "P4: detail 404 → unknown_asset: {body}"
    );
    assert!(body.get("message").and_then(|x| x.as_str()).is_some());
}

#[tokio::test]
async fn asset_history_invalid_bucket_returns_json_400() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!("{base}/v1/assets/jitoSOL/history?bucket=bogus"))
        .send()
        .await
        .expect("history bogus bucket");
    assert_eq!(resp.status(), 400, "invalid ?bucket= must 400");
    let ct = resp
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_owned();
    assert!(
        ct.starts_with("application/json"),
        "P4: 400 body must be JSON, got `{ct}`"
    );
    let body: Value = resp.json().await.expect("400 JSON envelope");
    assert_eq!(
        body.get("error").and_then(|x| x.as_str()),
        Some("invalid_bucket"),
        "P4: history bad bucket → invalid_bucket: {body}"
    );
}

#[tokio::test]
async fn asset_by_mint_matches_by_symbol() {
    let Some(base) = base_url() else { return };
    // jitoSOL's mainnet mint — a canonical tracked asset.
    const SYM: &str = "jitoSOL";
    const MINT: &str = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";

    // detail parity: by-mint resolves to the same card as by-symbol.
    let by_sym: Value = client()
        .get(format!("{base}/v1/assets/{SYM}"))
        .send()
        .await
        .expect("by-symbol")
        .json()
        .await
        .expect("by-symbol json");
    let resp = client()
        .get(format!("{base}/v1/assets/by-mint/{MINT}"))
        .send()
        .await
        .expect("by-mint");
    assert_eq!(resp.status(), 200, "by-mint detail must 200");
    let by_mint: Value = resp.json().await.expect("by-mint json");
    assert_eq!(
        by_mint.get("symbol"),
        by_sym.get("symbol"),
        "by-mint must resolve to the same asset as by-symbol"
    );
    assert_eq!(by_mint.get("mint").and_then(|x| x.as_str()), Some(MINT));

    // state parity: by-mint/state resolves to the same symbol.
    let st: Value = client()
        .get(format!("{base}/v1/assets/by-mint/{MINT}/state"))
        .send()
        .await
        .expect("by-mint state")
        .json()
        .await
        .expect("by-mint state json");
    assert_eq!(
        st.get("asset").and_then(|x| x.as_str()),
        Some(SYM),
        "by-mint state must resolve to the canonical symbol"
    );

    // A garbage mint → 404 with the JSON unknown_asset envelope (P4).
    let resp = client()
        .get(format!("{base}/v1/assets/by-mint/NOTAMINT_9999"))
        .send()
        .await
        .expect("bad mint");
    assert_eq!(resp.status(), 404, "unknown mint must 404");
    let body: Value = resp.json().await.expect("bad-mint json");
    assert_eq!(
        body.get("error").and_then(|x| x.as_str()),
        Some("unknown_asset"),
        "unknown mint → unknown_asset: {body}"
    );
}

#[tokio::test]
async fn asset_lookup_is_case_insensitive() {
    let Some(base) = base_url() else { return };

    // A lowercase variant of a canonical mixed-case symbol resolves, and the
    // response echoes the CANONICAL casing.
    let resp = client()
        .get(format!("{base}/v1/assets/jitosol"))
        .send()
        .await
        .expect("detail lowercased");
    assert_eq!(resp.status(), 200, "lowercased symbol must resolve");
    let card: Value = resp.json().await.expect("detail json");
    assert_eq!(
        card.get("symbol").and_then(|x| x.as_str()),
        Some("jitoSOL"),
        "detail must canonicalize the casing"
    );

    let st: Value = client()
        .get(format!("{base}/v1/assets/jitosol/state"))
        .send()
        .await
        .expect("state lowercased")
        .json()
        .await
        .expect("state json");
    assert_eq!(
        st.get("asset").and_then(|x| x.as_str()),
        Some("jitoSOL"),
        "state must canonicalize the casing"
    );

    // History for a mis-cased KNOWN symbol returns the same (non-empty) series.
    let hist = unwrap_list(
        client()
            .get(format!(
                "{base}/v1/assets/jitosol/history?bucket=1m&limit=5"
            ))
            .send()
            .await
            .expect("history lowercased")
            .json()
            .await
            .expect("history json"),
    );
    assert!(
        !hist.is_empty(),
        "history for a mis-cased known symbol must return rows"
    );

    // A truly-unknown symbol still 404s (unknown_asset), not a false resolve.
    let resp = client()
        .get(format!("{base}/v1/assets/zzz_not_a_symbol_9001"))
        .send()
        .await
        .expect("unknown");
    assert_eq!(resp.status(), 404, "unknown symbol must still 404");
}

#[tokio::test]
async fn pipeline_keeps_data_fresh() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!("{base}/v1/assets"))
        .send()
        .await
        .expect("assets");
    let list = unwrap_list(resp.json().await.expect("assets json"));

    // jitoSOL is one of the canonical LSTs and on the Jupiter market loop —
    // a healthy pipeline rewrites discount_snapshots roughly every 30s.
    let jito = list
        .iter()
        .find(|a| a.get("symbol").and_then(|s| s.as_str()) == Some("jitoSOL"))
        .expect("jitoSOL in universe");
    let updated_at = jito
        .get("updated_at")
        .and_then(|s| s.as_str())
        .expect("jitoSOL.updated_at");
    let parsed: DateTime<Utc> = updated_at.parse().expect("updated_at parse");
    let age = Utc::now() - parsed;
    assert!(
        age.num_seconds() < 600,
        "jitoSOL data stale: updated_at={updated_at}, age={}s. Indexer or engine likely dead.",
        age.num_seconds()
    );
}

// B-006: /v1/methodology/current keeps its original {version, status} shape AND
// surfaces the enriched lifecycle fields the table already stores. The 0.1.0
// seed row (migration 0030) is guaranteed present in any migrated DB.
#[tokio::test]
async fn methodology_current_returns_enriched_shape() {
    let Some(base) = base_url() else { return };
    let resp = client()
        .get(format!("{base}/v1/methodology/current"))
        .send()
        .await
        .expect("methodology current");
    assert_eq!(resp.status(), 200);
    let v: Value = resp.json().await.expect("methodology json");

    // Original v1 contract — must stay intact for the web trust strip.
    assert!(
        v.get("version").and_then(|x| x.as_str()).is_some(),
        "version must be a string: {v}"
    );
    assert!(
        v.get("status").and_then(|x| x.as_str()).is_some(),
        "status must be a string: {v}"
    );

    // Enriched additive fields (present because the seed row populates them).
    let git_tag = v.get("git_tag").and_then(|x| x.as_str());
    assert!(
        git_tag
            .map(|t| t.starts_with("methodology-v"))
            .unwrap_or(false),
        "git_tag must look like methodology-v*: {v}"
    );
    let released_at = v
        .get("released_at")
        .and_then(|x| x.as_str())
        .expect("released_at present");
    assert!(
        released_at.parse::<DateTime<Utc>>().is_ok(),
        "released_at must be RFC3339: {released_at}"
    );
}
