//! Confirms alert_evidence append-only enforcement against a real Postgres
//! instance. UPDATE blocked on the audit columns; onchain_tx_sig is
//! write-once (NULL → non-NULL); commit_status state machine enforced;
//! DELETE blocked.
//!
//! Gated on PEGANA_INTEGRATION_PG_URL. Skips silently in CI.
//!
//! Run locally (against prod-local stack on :5434):
//!   PEGANA_INTEGRATION_PG_URL=postgres://pegana:pegana@localhost:5434/pegana \
//!     cargo test -p engine-rs --test alert_evidence_append_only -- --nocapture
//!
//! Covers triggers from migrations 0028, 0031, 0033.

use sqlx::PgPool;
use uuid::Uuid;

fn pg_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_PG_URL")
        .ok()
        .filter(|s| !s.is_empty())
}

async fn insert_baseline(pool: &PgPool, alert_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO alerts (id, asset, class, from_state, to_state, discount,
                               intrinsic_usd, market_usd, confidence, detected_at, payload)
           VALUES ($1, 'USDC', 'stable_fiat'::asset_class, 'PEGGED'::peg_state, 'DRIFT'::peg_state,
                   0.001, 1.00, 0.999, 'high', NOW(), '{}'::jsonb)"#,
    )
    .bind(alert_id)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"INSERT INTO alert_evidence
               (alert_id, methodology_version, assets_toml_sha256,
                inputs_frozen, computed, receipt_sha256)
           VALUES ($1, '0.1.0', repeat('a', 64),
                   '{"asset":"USDC"}'::jsonb, '{"final_state":"DRIFT"}'::jsonb,
                   repeat('b', 64))"#,
    )
    .bind(alert_id)
    .execute(pool)
    .await?;
    Ok(())
}

#[tokio::test]
async fn update_methodology_version_is_blocked() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    insert_baseline(&pool, alert_id).await.expect("seed");

    let err =
        sqlx::query("UPDATE alert_evidence SET methodology_version = '0.2.0' WHERE alert_id = $1")
            .bind(alert_id)
            .execute(&pool)
            .await
            .expect_err("must block");
    assert!(err.to_string().contains("append-only"), "got: {err}");
}

#[tokio::test]
async fn delete_is_blocked() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    insert_baseline(&pool, alert_id).await.expect("seed");

    let err = sqlx::query("DELETE FROM alert_evidence WHERE alert_id = $1")
        .bind(alert_id)
        .execute(&pool)
        .await
        .expect_err("must block");
    assert!(err.to_string().contains("append-only"), "got: {err}");
}

#[tokio::test]
async fn onchain_tx_sig_can_be_set_once() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    insert_baseline(&pool, alert_id).await.expect("seed");

    // First set: NULL → 'abc...' — should succeed
    sqlx::query("UPDATE alert_evidence SET onchain_tx_sig = $1 WHERE alert_id = $2")
        .bind("abc123signature")
        .bind(alert_id)
        .execute(&pool)
        .await
        .expect("first set ok");

    // Second set: 'abc...' → 'def...' — should fail (write-once)
    let err = sqlx::query("UPDATE alert_evidence SET onchain_tx_sig = $1 WHERE alert_id = $2")
        .bind("def456signature")
        .bind(alert_id)
        .execute(&pool)
        .await
        .expect_err("write-once must block");
    assert!(err.to_string().contains("write-once"), "got: {err}");
}

#[tokio::test]
async fn commit_status_terminal_not_applicable_blocks_advance() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    insert_baseline(&pool, alert_id).await.expect("seed");

    // commit_status defaults to 'not_applicable' for new rows (per migration 0033).
    // Attempting to advance from that terminal value must be rejected.
    let err =
        sqlx::query("UPDATE alert_evidence SET commit_status = 'pending' WHERE alert_id = $1")
            .bind(alert_id)
            .execute(&pool)
            .await
            .expect_err("not_applicable is terminal");
    assert!(err.to_string().contains("terminal"), "got: {err}");
}

#[tokio::test]
async fn commit_status_pending_advances_to_committed() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();

    // Seed an alert that starts in 'pending' (simulating a critical alert
    // whose engine task spawned the on-chain commit).
    sqlx::query(
        r#"INSERT INTO alerts (id, asset, class, from_state, to_state, discount,
                               intrinsic_usd, market_usd, confidence, detected_at, payload)
           VALUES ($1, 'USDC', 'stable_fiat'::asset_class, 'PEGGED'::peg_state, 'CRITICAL'::peg_state,
                   0.05, 1.00, 0.95, 'high', NOW(), '{}'::jsonb)"#,
    )
    .bind(alert_id)
    .execute(&pool)
    .await
    .expect("seed alert");

    sqlx::query(
        r#"INSERT INTO alert_evidence
               (alert_id, methodology_version, assets_toml_sha256,
                inputs_frozen, computed, receipt_sha256, commit_status)
           VALUES ($1, '0.1.0', repeat('a', 64),
                   '{"asset":"USDC"}'::jsonb, '{"final_state":"CRITICAL"}'::jsonb,
                   repeat('c', 64), 'pending')"#,
    )
    .bind(alert_id)
    .execute(&pool)
    .await
    .expect("seed evidence");

    // Valid transition: pending → committed (alongside onchain_tx_sig set)
    sqlx::query(
        "UPDATE alert_evidence SET commit_status = 'committed', onchain_tx_sig = $1 WHERE alert_id = $2",
    )
    .bind("sigOK")
    .bind(alert_id)
    .execute(&pool)
    .await
    .expect("pending → committed must succeed");

    // Now 'committed' is terminal; further changes rejected.
    let err = sqlx::query(
        "UPDATE alert_evidence SET commit_status = 'retry_exhausted' WHERE alert_id = $1",
    )
    .bind(alert_id)
    .execute(&pool)
    .await
    .expect_err("committed is terminal");
    assert!(err.to_string().contains("terminal"), "got: {err}");
}

async fn insert_pending_evidence(pool: &PgPool, alert_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO alerts (id, asset, class, from_state, to_state, discount,
                               intrinsic_usd, market_usd, confidence, detected_at, payload)
           VALUES ($1, 'USDC', 'stable_fiat'::asset_class, 'PEGGED'::peg_state, 'CRITICAL'::peg_state,
                   0.05, 1.00, 0.95, 'high', NOW(), '{}'::jsonb)"#,
    )
    .bind(alert_id)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"INSERT INTO alert_evidence
               (alert_id, methodology_version, assets_toml_sha256,
                inputs_frozen, computed, receipt_sha256, commit_status)
           VALUES ($1, '0.1.0', repeat('a', 64),
                   '{"asset":"USDC"}'::jsonb, '{"final_state":"CRITICAL"}'::jsonb,
                   repeat('c', 64), 'pending')"#,
    )
    .bind(alert_id)
    .execute(pool)
    .await?;
    Ok(())
}

#[tokio::test]
async fn other_audit_columns_are_frozen() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");

    // Each audit column gets its own isolated row + UPDATE attempt — using
    // a single row would fail after the first mutation rejection but mask
    // whether subsequent columns are also frozen.
    let cases: &[(&str, &str)] = &[
        ("inputs_frozen", "'{\"tampered\":true}'::jsonb"),
        ("computed", "'{\"tampered\":true}'::jsonb"),
        ("replay_artifact", "'{\"tampered\":true}'::jsonb"),
        ("receipt_sha256", "repeat('f', 64)"),
        ("methodology_git_sha", "'tampered'"),
        ("assets_toml_sha256", "repeat('f', 64)"),
    ];

    for (col, value) in cases {
        let alert_id = Uuid::new_v4();
        insert_baseline(&pool, alert_id).await.expect("seed");

        let sql = format!("UPDATE alert_evidence SET {col} = {value} WHERE alert_id = $1");
        let err = sqlx::query(&sql)
            .bind(alert_id)
            .execute(&pool)
            .await
            .expect_err(&format!("UPDATE {col} must block"));
        assert!(
            err.to_string().contains("append-only"),
            "UPDATE {col} got unexpected error: {err}"
        );
    }
}

#[tokio::test]
async fn commit_status_pending_advances_to_retry_exhausted() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    insert_pending_evidence(&pool, alert_id)
        .await
        .expect("seed pending");

    // The real ADR-0004 dead-letter worker (onchain_commit::retry_once →
    // abandon_failure) sets this terminal state after 24h of failures; here we
    // assert only the trigger-level transition with a raw UPDATE. End-to-end
    // worker coverage lives in tests/commit_retry_worker.rs.
    sqlx::query("UPDATE alert_evidence SET commit_status = 'retry_exhausted' WHERE alert_id = $1")
        .bind(alert_id)
        .execute(&pool)
        .await
        .expect("pending → retry_exhausted must succeed");

    // retry_exhausted is terminal — further advance rejected.
    let err =
        sqlx::query("UPDATE alert_evidence SET commit_status = 'committed' WHERE alert_id = $1")
            .bind(alert_id)
            .execute(&pool)
            .await
            .expect_err("retry_exhausted is terminal");
    assert!(err.to_string().contains("terminal"), "got: {err}");
}

#[tokio::test]
async fn commit_status_pending_advances_to_wallet_drained() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    insert_pending_evidence(&pool, alert_id)
        .await
        .expect("seed pending");

    // InsufficientFundsForFee from the on-chain RPC sets this terminal state
    // immediately (per ADR-0004: no retry on funding failure).
    sqlx::query("UPDATE alert_evidence SET commit_status = 'wallet_drained' WHERE alert_id = $1")
        .bind(alert_id)
        .execute(&pool)
        .await
        .expect("pending → wallet_drained must succeed");

    // wallet_drained is terminal.
    let err =
        sqlx::query("UPDATE alert_evidence SET commit_status = 'pending' WHERE alert_id = $1")
            .bind(alert_id)
            .execute(&pool)
            .await
            .expect_err("wallet_drained is terminal");
    assert!(err.to_string().contains("terminal"), "got: {err}");
}

#[tokio::test]
async fn truncate_is_blocked_on_append_only_tables() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");

    // Per migration 0037 (TRUNCATE-block fix): trying TRUNCATE on any
    // append-only table must raise from block_truncate_append_only().
    for table in [
        "alert_evidence",
        "alert_evidence_pending",
        "alert_evidence_commit_failures",
        "retractions",
    ] {
        let sql = format!("TRUNCATE {table} CASCADE");
        let err = sqlx::query(&sql)
            .execute(&pool)
            .await
            .expect_err(&format!("TRUNCATE {table} must block"));
        assert!(
            err.to_string().contains("append-only") || err.to_string().contains("TRUNCATE blocked"),
            "TRUNCATE {table} got unexpected error: {err}"
        );
    }
}
