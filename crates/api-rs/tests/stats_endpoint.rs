//! Black-box integration test for /v1/stats.delivery_health.
//!
//! Gated on `PEGANA_INTEGRATION_API_BASE` + `PEGANA_INTEGRATION_PG_URL` so
//! `cargo test` in CI without infra passes silently. Run locally with:
//!
//! ```bash
//! PEGANA_INTEGRATION_API_BASE=http://localhost:8081 \
//! PEGANA_INTEGRATION_PG_URL=postgres://pegana:pegana@localhost:5434/pegana \
//! cargo test -p api-rs --test stats_endpoint -- --nocapture
//! ```
//!
//! The test seeds an unacknowledged failed delivery, hits the endpoint,
//! asserts the rollup shape, then acks the row and asserts the failure
//! drops out of the count. This pins both the response contract and the
//! ack filter semantics introduced in migration 0019.

use serde_json::Value;

fn base() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_API_BASE").ok()
}
fn pg_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_PG_URL").ok()
}

/// Seed a failed-delivery row and return its alert_id. Uses random UUIDs
/// plus a marker string so this test's rows never collide with real data
/// and are trivial to clean up. The asset symbol must already exist in
/// the `assets` table (FK constraint); we pick the first active asset
/// dynamically so the test isn't tied to a specific seed.
async fn seed_failed_delivery(pool: &sqlx::PgPool, marker: &str) -> uuid::Uuid {
    let alert_id = uuid::Uuid::new_v4();
    let asset: (String,) = sqlx::query_as("SELECT symbol FROM assets WHERE is_active LIMIT 1")
        .fetch_one(pool)
        .await
        .expect("at least one active asset must exist");
    // Insert the alert first (FK target).
    sqlx::query(
        r#"
        INSERT INTO alerts
            (id, asset, class, from_state, to_state, discount, intrinsic_usd, market_usd,
             confidence, detected_at, payload)
        VALUES ($1, $2, 'lst'::asset_class, 'PEGGED'::peg_state, 'DRIFT'::peg_state,
                0, 1, 1, 'high', now(), '{}'::jsonb)
        "#,
    )
    .bind(alert_id)
    .bind(&asset.0)
    .execute(pool)
    .await
    .expect("insert alerts");
    sqlx::query(
        r#"
        INSERT INTO alert_deliveries
            (alert_id, subscription_id, channel, status, error, attempted_at, completed_at)
        VALUES ($1, NULL, 'telegram', 'failed', $2, now(), now())
        "#,
    )
    .bind(alert_id)
    .bind(marker)
    .execute(pool)
    .await
    .expect("insert delivery");
    alert_id
}

async fn cleanup(pool: &sqlx::PgPool, alert_id: uuid::Uuid) {
    let _ = sqlx::query("DELETE FROM alert_deliveries WHERE alert_id = $1")
        .bind(alert_id)
        .execute(pool)
        .await;
    // alerts rows are append-only (migration 0082), so the seeded alert is
    // left behind in the test database; only its delivery rows are removed.
}

async fn fetch_stats(base_url: &str) -> Value {
    reqwest::get(format!("{base_url}/v1/stats"))
        .await
        .expect("GET /v1/stats")
        .json()
        .await
        .expect("decode json")
}

#[tokio::test]
async fn stats_delivery_health_shape_and_ack_semantics() {
    let Some(base_url) = base() else {
        eprintln!("skip: PEGANA_INTEGRATION_API_BASE not set");
        return;
    };
    let Some(pg) = pg_url() else {
        eprintln!("skip: PEGANA_INTEGRATION_PG_URL not set");
        return;
    };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");

    // Marker carries a chat_id-shaped number so the redact path also runs.
    let marker = "integration test failure for chat_id=999888777";
    let alert_id = seed_failed_delivery(&pool, marker).await;

    // 1. Endpoint reports our un-acked failure and redacts the chat_id.
    let stats = fetch_stats(&base_url).await;
    let health = stats
        .get("delivery_health")
        .expect("delivery_health field present");
    assert!(
        health.get("sent_24h").and_then(|v| v.as_i64()).is_some(),
        "sent_24h numeric"
    );
    let failed_before = health
        .get("failed_24h")
        .and_then(|v| v.as_i64())
        .expect("failed_24h numeric");
    assert!(
        failed_before >= 1,
        "seeded row should appear in failed_24h (got {failed_before})"
    );
    let last_err = health
        .get("last_failure_error")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    // The marker's chat_id (9 digits) must be redacted; the rest of the
    // string passes through. We don't assert the FULL string because
    // `last_failure_error` returns the most recent failure across the
    // whole table, which may be a different row in a noisy environment.
    if last_err.contains("integration test") {
        assert!(
            last_err.contains("[REDACTED_ID]"),
            "expected redaction of 999888777, got: {last_err}"
        );
        assert!(!last_err.contains("999888777"));
    }

    // 2. Ack the seeded row; the count drops.
    sqlx::query(
        "UPDATE alert_deliveries SET acknowledged_at = NOW(), ack_reason = 'integration test ack' \
         WHERE alert_id = $1",
    )
    .bind(alert_id)
    .execute(&pool)
    .await
    .expect("ack update");

    let stats2 = fetch_stats(&base_url).await;
    let failed_after = stats2
        .pointer("/delivery_health/failed_24h")
        .and_then(|v| v.as_i64())
        .expect("failed_24h after ack");
    assert_eq!(
        failed_after,
        failed_before - 1,
        "acking the seeded row should decrement failed_24h exactly by 1"
    );

    cleanup(&pool, alert_id).await;
}

fn by_state_sum(stats: &Value) -> i64 {
    stats
        .get("by_state")
        .and_then(|v| v.as_object())
        .map(|o| o.values().filter_map(|v| v.as_i64()).sum())
        .unwrap_or(0)
}
fn tracked(stats: &Value) -> i64 {
    stats
        .get("assets_tracked")
        .and_then(|v| v.as_i64())
        .expect("assets_tracked numeric")
}
async fn cleanup_test_asset(pool: &sqlx::PgPool, symbol: &str) {
    let _ = sqlx::query("DELETE FROM discount_snapshots WHERE asset = $1")
        .bind(symbol)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM assets WHERE symbol = $1")
        .bind(symbol)
        .execute(pool)
        .await;
}

/// BONUS-stats: `by_state` must be gated to active assets so it reconciles with
/// `assets_tracked` (the historical 21-vs-22 off-by-one). Uses a SYNTHETIC asset
/// (`ZZ_STATS_TEST`) so it never disturbs real rows, and proves the JOIN both
/// ways: an inactive asset with a fresh snapshot is invisible to by_state AND
/// assets_tracked; activating it makes it appear in BOTH by exactly 1. Also pins
/// the always-true invariant `sum(by_state) <= assets_tracked` (pre-fix VIOLATED
/// whenever a soft-deleted asset still has snapshots).
#[tokio::test]
async fn stats_by_state_excludes_inactive_assets() {
    let Some(base_url) = base() else {
        eprintln!("skip: PEGANA_INTEGRATION_API_BASE not set");
        return;
    };
    let Some(pg) = pg_url() else {
        eprintln!("skip: PEGANA_INTEGRATION_PG_URL not set");
        return;
    };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");

    const SYM: &str = "ZZ_STATS_TEST";
    cleanup_test_asset(&pool, SYM).await; // clear any aborted-run leftover

    // Baseline + the core invariant the fix establishes.
    let base_stats = fetch_stats(&base_url).await;
    let base_sum = by_state_sum(&base_stats);
    let base_tracked = tracked(&base_stats);
    assert!(
        base_sum <= base_tracked,
        "by_state sum ({base_sum}) must be <= assets_tracked ({base_tracked})"
    );

    // Seed an INACTIVE asset with a fresh (DISTINCT-ON-winning) PEGGED snapshot.
    sqlx::query(
        r#"INSERT INTO assets
             (symbol, mint, name, class, peg_target, decimals, intrinsic_kind, thresholds, is_active)
           VALUES ($1, $2, 'Stats Test Asset', 'lst'::asset_class, 'SOL'::peg_target, 9,
                   'pyth_redemption_rate', '{}'::jsonb, false)"#,
    )
    .bind(SYM)
    .bind(format!("MINT_{SYM}"))
    .execute(&pool)
    .await
    .expect("insert inactive asset");
    sqlx::query(
        r#"INSERT INTO discount_snapshots
             (asset, discount_raw, discount_smooth, state, confidence, intrinsic_usd, market_usd, ts)
           VALUES ($1, 0, 0, 'PEGGED'::peg_state, 'high', 1, 1, now())"#,
    )
    .bind(SYM)
    .execute(&pool)
    .await
    .expect("insert snapshot");

    // INACTIVE → invisible to BOTH counters (pre-fix, by_state would be +1 here).
    let inactive = fetch_stats(&base_url).await;
    assert_eq!(
        by_state_sum(&inactive),
        base_sum,
        "inactive asset must NOT appear in by_state"
    );
    assert_eq!(
        tracked(&inactive),
        base_tracked,
        "inactive asset must NOT appear in assets_tracked"
    );

    // ACTIVE → counted in BOTH, by exactly 1; they stay reconciled.
    sqlx::query("UPDATE assets SET is_active = true WHERE symbol = $1")
        .bind(SYM)
        .execute(&pool)
        .await
        .expect("activate");
    let active = fetch_stats(&base_url).await;
    assert_eq!(
        by_state_sum(&active),
        base_sum + 1,
        "active asset must appear in by_state"
    );
    assert_eq!(
        tracked(&active),
        base_tracked + 1,
        "active asset must appear in assets_tracked"
    );

    cleanup_test_asset(&pool, SYM).await;
}
