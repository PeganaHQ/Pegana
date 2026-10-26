//! Integration test: `state_reason` flows from `discount_snapshots` through
//! both `/v1/assets` and `/v1/assets/{symbol}/state`.
//!
//! Requires a running api-rs server + Postgres, gated on env vars:
//!
//! ```bash
//! PEGANA_INTEGRATION_API_BASE=http://localhost:8081 \
//! PEGANA_INTEGRATION_PG_URL=postgres://pegana:pegana@localhost:5434/pegana \
//! cargo test -p pegana-api --test state_reason -- --nocapture
//! ```
//!
//! When either env var is absent the test short-circuits (prints skip + exits
//! cleanly), matching the pattern in `state_error_discrimination.rs`.

use serde_json::Value;

fn base() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_API_BASE").ok()
}
fn pg_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_PG_URL").ok()
}

/// `/v1/assets` now returns the uniform list envelope
/// `{ ok, generated_at, count, data:[…] }`. Assert the envelope and hand back
/// the `data` array so each test inspects asset cards as before.
fn unwrap_list(v: Value) -> Vec<Value> {
    assert_eq!(
        v.get("ok").and_then(|x| x.as_bool()),
        Some(true),
        "list envelope must carry ok:true — got {v}"
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

async fn cleanup(pool: &sqlx::PgPool, symbol: &str) {
    let _ = sqlx::query("DELETE FROM discount_snapshots WHERE asset = $1")
        .bind(symbol)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM assets WHERE symbol = $1")
        .bind(symbol)
        .execute(pool)
        .await;
}

/// Seeds a minimal asset + a discount_snapshots row with
/// `state_reason = 'premium_sanity'`, then asserts:
///   1. `/v1/assets` includes the asset card with `state_reason == "premium_sanity"`.
///   2. `/v1/assets/{symbol}/state` returns `state_reason == "premium_sanity"`.
#[tokio::test]
async fn state_reason_surfaces_on_assets_and_state_endpoints() {
    let Some(base) = base() else {
        eprintln!("skip: PEGANA_INTEGRATION_API_BASE not set");
        return;
    };
    let Some(pg) = pg_url() else {
        eprintln!("skip: PEGANA_INTEGRATION_PG_URL not set");
        return;
    };

    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let client = reqwest::Client::new();

    const SYM: &str = "ZZ_STATE_REASON_TEST";
    cleanup(&pool, SYM).await; // clear any aborted-run leftover

    // Insert a minimal active asset.
    sqlx::query(
        r#"INSERT INTO assets
             (symbol, mint, name, class, peg_target, decimals, intrinsic_kind, thresholds, is_active)
           VALUES ($1, $2, 'State Reason Test Asset', 'lst'::asset_class, 'SOL'::peg_target, 9,
                   'pyth_redemption_rate', '{}'::jsonb, true)"#,
    )
    .bind(SYM)
    .bind(format!("MINT_{SYM}"))
    .execute(&pool)
    .await
    .expect("insert test asset");

    // Insert a recent discount_snapshots row with state_reason = 'premium_sanity'.
    sqlx::query(
        r#"INSERT INTO discount_snapshots
             (asset, discount_raw, discount_smooth, oracle_discount, state, confidence,
              intrinsic_usd, market_usd, extra, ts, state_reason)
           VALUES ($1, 0.01, 0.01, NULL, 'UNKNOWN'::peg_state, 'unknown',
                   1.00, 1.01, '{}'::jsonb, now(), 'premium_sanity')"#,
    )
    .bind(SYM)
    .execute(&pool)
    .await
    .expect("insert discount snapshot with state_reason");

    // 1. /v1/assets — find the card for our test asset and check state_reason.
    let resp = client
        .get(format!("{base}/v1/assets"))
        .send()
        .await
        .expect("GET /v1/assets");
    assert_eq!(resp.status(), 200, "/v1/assets must be 200");
    let cards = unwrap_list(resp.json().await.expect("/v1/assets JSON"));

    let card = cards
        .iter()
        .find(|c| c.get("symbol").and_then(|s| s.as_str()) == Some(SYM))
        .unwrap_or_else(|| panic!("asset {SYM} not found in /v1/assets response"));

    assert_eq!(
        card.get("state_reason").and_then(|x| x.as_str()),
        Some("premium_sanity"),
        "state_reason must be 'premium_sanity' on AssetCard: {card}"
    );

    // 2. /v1/assets/{symbol}/state — check state_reason on StateResp.
    let resp = client
        .get(format!("{base}/v1/assets/{SYM}/state"))
        .send()
        .await
        .expect("GET /state");
    assert_eq!(resp.status(), 200, "/state must be 200 for seeded asset");
    let state_resp: Value = resp.json().await.expect("/state JSON");

    assert_eq!(
        state_resp.get("state_reason").and_then(|x| x.as_str()),
        Some("premium_sanity"),
        "state_reason must be 'premium_sanity' on StateResp: {state_resp}"
    );

    cleanup(&pool, SYM).await;
}

/// When `state_reason` is NULL, the field MUST be ABSENT from JSON (not `null`),
/// matching the `#[serde(skip_serializing_if = "Option::is_none")]` contract.
#[tokio::test]
async fn state_reason_absent_when_null() {
    let Some(base) = base() else {
        eprintln!("skip: PEGANA_INTEGRATION_API_BASE not set");
        return;
    };
    let Some(pg) = pg_url() else {
        eprintln!("skip: PEGANA_INTEGRATION_PG_URL not set");
        return;
    };

    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let client = reqwest::Client::new();

    const SYM: &str = "ZZ_STATE_REASON_NULL_TEST";
    cleanup(&pool, SYM).await;

    // Insert a minimal active asset.
    sqlx::query(
        r#"INSERT INTO assets
             (symbol, mint, name, class, peg_target, decimals, intrinsic_kind, thresholds, is_active)
           VALUES ($1, $2, 'State Reason Null Test', 'lst'::asset_class, 'SOL'::peg_target, 9,
                   'pyth_redemption_rate', '{}'::jsonb, true)"#,
    )
    .bind(SYM)
    .bind(format!("MINT_{SYM}"))
    .execute(&pool)
    .await
    .expect("insert test asset");

    // Insert a snapshot WITHOUT state_reason (default NULL).
    sqlx::query(
        r#"INSERT INTO discount_snapshots
             (asset, discount_raw, discount_smooth, oracle_discount, state, confidence,
              intrinsic_usd, market_usd, extra, ts)
           VALUES ($1, 0.001, 0.001, NULL, 'PEGGED'::peg_state, 'high',
                   1.00, 1.001, '{}'::jsonb, now())"#,
    )
    .bind(SYM)
    .execute(&pool)
    .await
    .expect("insert snapshot without state_reason");

    // /v1/assets — state_reason key must be absent (not null).
    let resp = client
        .get(format!("{base}/v1/assets"))
        .send()
        .await
        .expect("GET /v1/assets");
    let cards = unwrap_list(resp.json().await.expect("/v1/assets JSON"));
    let card = cards
        .iter()
        .find(|c| c.get("symbol").and_then(|s| s.as_str()) == Some(SYM))
        .unwrap_or_else(|| panic!("asset {SYM} not found in /v1/assets"));

    assert!(
        card.get("state_reason").is_none(),
        "state_reason must be absent (not null) when NULL in DB: {card}"
    );

    // /v1/assets/{symbol}/state — state_reason key must be absent too.
    let resp = client
        .get(format!("{base}/v1/assets/{SYM}/state"))
        .send()
        .await
        .expect("GET /state");
    let state_resp: Value = resp.json().await.expect("/state JSON");
    assert!(
        state_resp.get("state_reason").is_none(),
        "state_reason must be absent from StateResp when NULL: {state_resp}"
    );

    cleanup(&pool, SYM).await;
}
