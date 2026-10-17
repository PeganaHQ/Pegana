//! Integration test: `/v1/assets/{symbol}/state` collapses to `UNKNOWN` +
//! `state_reason = "stale_source"` when the most-recent snapshot is older than
//! 15 minutes (EURC divergence fix).
//!
//! Before the fix, the endpoint returned the frozen last `state` (e.g. `PEGGED`)
//! with `stale: true` — contradicting `/v1/assets` which gates to `null` on
//! staleness.  After the fix both endpoints agree: missing data is not confirming
//! data.
//!
//! Requires a running api-rs server + Postgres:
//!
//! ```bash
//! PEGANA_INTEGRATION_API_BASE=http://localhost:8081 \
//! PEGANA_INTEGRATION_PG_URL=postgres://pegana:pegana@localhost:5434/pegana \
//! cargo test -p pegana-api --test stale_source_collapse -- --nocapture
//! ```
//!
//! When either env var is absent the test short-circuits (prints skip + exits
//! cleanly), matching the pattern in `state_reason.rs`.

use serde_json::Value;

fn base() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_API_BASE").ok()
}
fn pg_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_PG_URL").ok()
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

/// Seeds an asset with a snapshot whose `ts` is 30 minutes in the past
/// (i.e. older than the 15-minute freshness gate) and `state = 'PEGGED'`.
///
/// Asserts that `GET /v1/assets/{symbol}/state` returns:
///   - `state == "UNKNOWN"` (not the frozen "PEGGED")
///   - `state_reason == "stale_source"`
///   - `stale == true`
///   - `updated_at` and `discount` are still present (consumers keep their flag)
#[tokio::test]
async fn stale_snapshot_collapses_to_unknown_stale_source() {
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

    const SYM: &str = "ZZ_STALE_SOURCE_TEST";
    cleanup(&pool, SYM).await; // clear any aborted-run leftover

    // Insert a minimal active asset (FX stable, like EURC).
    sqlx::query(
        r#"INSERT INTO assets
             (symbol, mint, name, class, peg_target, decimals, intrinsic_kind, thresholds, is_active)
           VALUES ($1, $2, 'Stale Source Test Asset', 'stable_fiat'::asset_class, 'USD'::peg_target, 6,
                   'pyth_fx', '{}'::jsonb, true)"#,
    )
    .bind(SYM)
    .bind(format!("MINT_{SYM}"))
    .execute(&pool)
    .await
    .expect("insert test asset");

    // Insert a STALE snapshot: ts = now() - 30 minutes, state = PEGGED.
    // Before the fix, /state would return state="PEGGED", stale=true.
    // After the fix it must return state="UNKNOWN", state_reason="stale_source".
    sqlx::query(
        r#"INSERT INTO discount_snapshots
             (asset, discount_raw, discount_smooth, oracle_discount, state, confidence,
              intrinsic_usd, market_usd, extra, ts, state_reason)
           VALUES ($1, 0.001, 0.001, NULL, 'PEGGED'::peg_state, 'high',
                   1.08, 1.081, '{}'::jsonb, now() - INTERVAL '30 minutes', NULL)"#,
    )
    .bind(SYM)
    .execute(&pool)
    .await
    .expect("insert stale snapshot");

    let resp = client
        .get(format!("{base}/v1/assets/{SYM}/state"))
        .send()
        .await
        .expect("GET /state");

    assert_eq!(resp.status(), 200, "/state must be 200 for seeded asset");

    let body: Value = resp.json().await.expect("/state JSON");

    // Core assertions: stale snapshot must collapse to UNKNOWN + stale_source.
    assert_eq!(
        body.get("state").and_then(|x| x.as_str()),
        Some("UNKNOWN"),
        "stale snapshot must collapse state to UNKNOWN: {body}"
    );
    assert_eq!(
        body.get("state_reason").and_then(|x| x.as_str()),
        Some("stale_source"),
        "stale snapshot must set state_reason to stale_source: {body}"
    );
    assert_eq!(
        body.get("stale").and_then(|x| x.as_bool()),
        Some(true),
        "stale flag must be true: {body}"
    );

    // `since` must equal `updated_at` (i.e. c.ts, when data stopped) — not the
    // start of the now-collapsed stored state.  A consumer computing
    // "age of current UNKNOWN" would otherwise get a misleadingly old duration.
    let since_str = body
        .get("since")
        .and_then(|x| x.as_str())
        .expect("since must be present: {body}");
    let updated_at_str = body
        .get("updated_at")
        .and_then(|x| x.as_str())
        .expect("updated_at must be present: {body}");
    assert_eq!(
        since_str, updated_at_str,
        "when stale, since must equal updated_at (c.ts), not the old stored state's since: {body}"
    );

    // Preservation assertions: existing consumers still receive discount + updated_at.
    assert!(
        body.get("discount").is_some(),
        "discount must still be present for existing consumers: {body}"
    );
    assert!(
        body.get("updated_at").and_then(|x| x.as_str()).is_some(),
        "updated_at must still be present: {body}"
    );

    cleanup(&pool, SYM).await;
}

/// Sanity: a fresh snapshot (ts = now()) must NOT be collapsed — it returns
/// the real state and stale=false, with state_reason from the DB (or absent).
#[tokio::test]
async fn fresh_snapshot_not_collapsed() {
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

    const SYM: &str = "ZZ_FRESH_SNAPSHOT_TEST";
    cleanup(&pool, SYM).await;

    sqlx::query(
        r#"INSERT INTO assets
             (symbol, mint, name, class, peg_target, decimals, intrinsic_kind, thresholds, is_active)
           VALUES ($1, $2, 'Fresh Snapshot Test Asset', 'stable_fiat'::asset_class, 'USD'::peg_target, 6,
                   'pyth_fx', '{}'::jsonb, true)"#,
    )
    .bind(SYM)
    .bind(format!("MINT_{SYM}"))
    .execute(&pool)
    .await
    .expect("insert test asset");

    // Insert a FRESH snapshot (ts = now()).
    sqlx::query(
        r#"INSERT INTO discount_snapshots
             (asset, discount_raw, discount_smooth, oracle_discount, state, confidence,
              intrinsic_usd, market_usd, extra, ts, state_reason)
           VALUES ($1, 0.001, 0.001, NULL, 'PEGGED'::peg_state, 'high',
                   1.08, 1.081, '{}'::jsonb, now(), NULL)"#,
    )
    .bind(SYM)
    .execute(&pool)
    .await
    .expect("insert fresh snapshot");

    let resp = client
        .get(format!("{base}/v1/assets/{SYM}/state"))
        .send()
        .await
        .expect("GET /state");

    assert_eq!(resp.status(), 200, "/state must be 200 for seeded asset");
    let body: Value = resp.json().await.expect("/state JSON");

    // Fresh snapshot: must NOT collapse — real state is PEGGED.
    assert_eq!(
        body.get("state").and_then(|x| x.as_str()),
        Some("PEGGED"),
        "fresh snapshot must NOT collapse state: {body}"
    );
    assert_eq!(
        body.get("stale").and_then(|x| x.as_bool()),
        Some(false),
        "fresh snapshot must have stale=false: {body}"
    );
    // state_reason is NULL in DB → must be absent from JSON.
    assert!(
        body.get("state_reason").is_none(),
        "state_reason must be absent when NULL in DB (fresh snapshot): {body}"
    );

    cleanup(&pool, SYM).await;
}
