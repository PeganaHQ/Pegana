//! ADR-0004 dead-letter retry worker (`onchain_commit::retry_once`) against a
//! real Postgres. Seeds `alert_evidence_commit_failures` rows via raw SQL and
//! runs the inner step function (no infinite loop, no live RPC):
//!
//!   * success → committed: the worker's success-path DB transition flips the
//!     parent to `committed` + resolves the failure row;
//!   * 24h aged-out (generic error) → parent flips to `retry_exhausted`,
//!     failure row abandoned;
//!   * 24h aged-out (insufficient_funds) → parent flips to `wallet_drained`.
//!
//! The aged-out branches never contact the RPC (they short-circuit in
//! `retry_once` before `do_commit_with_retry`), so the test is hermetic. The
//! success branch is asserted via `commit_success_for_test` (the same two SQL
//! writes the live worker runs after a commit lands) to avoid a live RPC.
//!
//! Gated on PEGANA_INTEGRATION_PG_URL. Skips silently in CI.
//!
//! Run locally (against prod-local stack on :5434):
//!   PEGANA_INTEGRATION_PG_URL=postgres://pegana:pegana@localhost:5434/pegana \
//!     cargo test -p engine-rs --test commit_retry_worker -- --nocapture

use engine_rs::onchain_commit::{commit_success_for_test, retry_once, CommitContext};
use sqlx::PgPool;
use uuid::Uuid;

fn pg_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_PG_URL")
        .ok()
        .filter(|s| !s.is_empty())
}

/// Seed an alert + its `pending` evidence row (the state a critical alert is in
/// while its on-chain commit is outstanding).
async fn seed_pending_evidence(pool: &PgPool, alert_id: Uuid) {
    sqlx::query(
        r#"INSERT INTO alerts (id, asset, class, from_state, to_state, discount,
                               intrinsic_usd, market_usd, confidence, detected_at, payload)
           VALUES ($1, 'USDC', 'stable_fiat'::asset_class, 'PEGGED'::peg_state, 'CRITICAL'::peg_state,
                   0.05, 1.00, 0.95, 'high', NOW(), '{}'::jsonb)"#,
    )
    .bind(alert_id)
    .execute(pool)
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
    .execute(pool)
    .await
    .expect("seed pending evidence");
}

/// Seed a failure row. `first_failed_ago` / `last_attempted_ago` are Postgres
/// interval literals (e.g. "25 hours", "2 hours").
async fn seed_failure(
    pool: &PgPool,
    alert_id: Uuid,
    error_kind: &str,
    first_failed_ago: &str,
    last_attempted_ago: &str,
) {
    let sql = format!(
        "INSERT INTO alert_evidence_commit_failures \
             (alert_id, first_failed_at, last_attempted_at, attempts, last_error, error_kind) \
         VALUES ($1, NOW() - INTERVAL '{first_failed_ago}', NOW() - INTERVAL '{last_attempted_ago}', \
                 3, 'seed error', $2)"
    );
    sqlx::query(&sql)
        .bind(alert_id)
        .bind(error_kind)
        .execute(pool)
        .await
        .expect("seed failure row");
}

async fn commit_status(pool: &PgPool, alert_id: Uuid) -> String {
    sqlx::query_scalar::<_, String>("SELECT commit_status FROM alert_evidence WHERE alert_id = $1")
        .bind(alert_id)
        .fetch_one(pool)
        .await
        .expect("read commit_status")
}

#[tokio::test]
async fn retry_success_marks_committed() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    seed_pending_evidence(&pool, alert_id).await;
    seed_failure(&pool, alert_id, "rpc", "2 hours", "2 hours").await;

    // Drive the success-path DB transition the worker runs after a commit lands.
    commit_success_for_test(&pool, alert_id, "retrySigOK")
        .await
        .expect("commit success transition");

    assert_eq!(commit_status(&pool, alert_id).await, "committed");

    let sig: Option<String> =
        sqlx::query_scalar("SELECT onchain_tx_sig FROM alert_evidence WHERE alert_id = $1")
            .bind(alert_id)
            .fetch_one(&pool)
            .await
            .expect("read sig");
    assert_eq!(sig.as_deref(), Some("retrySigOK"));

    // Failure row resolved (abandoned_at set) so it stops being scanned.
    let abandoned: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
        "SELECT abandoned_at FROM alert_evidence_commit_failures WHERE alert_id = $1",
    )
    .bind(alert_id)
    .fetch_one(&pool)
    .await
    .expect("read abandoned_at");
    assert!(
        abandoned.is_some(),
        "resolved failure row must have abandoned_at set"
    );
}

#[tokio::test]
async fn retry_aged_out_generic_marks_retry_exhausted() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    seed_pending_evidence(&pool, alert_id).await;
    // first_failed >24h ago, last_attempted >1h ago → eligible + aged_out.
    seed_failure(&pool, alert_id, "rpc", "25 hours", "2 hours").await;

    let ctx = CommitContext::new_for_test(pool.clone());
    // The worker scans the whole table (no per-alert_id filter), so a concurrent
    // test's tick may abandon this row first — don't assert on the racy global
    // `abandoned` count; assert THIS alert reached its terminal state (matches
    // retry_skips_when_parent_not_pending below).
    let _ = retry_once(&ctx).await.expect("retry tick");

    assert_eq!(commit_status(&pool, alert_id).await, "retry_exhausted");

    let abandoned: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
        "SELECT abandoned_at FROM alert_evidence_commit_failures WHERE alert_id = $1",
    )
    .bind(alert_id)
    .fetch_one(&pool)
    .await
    .expect("read abandoned_at");
    assert!(
        abandoned.is_some(),
        "aged-out failure row must be abandoned"
    );
}

#[tokio::test]
async fn retry_aged_out_insufficient_funds_marks_wallet_drained() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    seed_pending_evidence(&pool, alert_id).await;
    seed_failure(&pool, alert_id, "insufficient_funds", "25 hours", "2 hours").await;

    let ctx = CommitContext::new_for_test(pool.clone());
    // The worker scans the whole table (no per-alert_id filter), so a concurrent
    // test's tick may abandon this row first — don't assert on the racy global
    // `abandoned` count; assert THIS alert reached its terminal state (matches
    // retry_skips_when_parent_not_pending below).
    let _ = retry_once(&ctx).await.expect("retry tick");

    assert_eq!(commit_status(&pool, alert_id).await, "wallet_drained");
}

#[tokio::test]
async fn retry_skips_when_parent_not_pending() {
    // A failure row whose parent already went terminal (e.g. committed via the
    // live path) must NOT be scanned — the JOIN gates on commit_status='pending'.
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    seed_pending_evidence(&pool, alert_id).await;
    seed_failure(&pool, alert_id, "rpc", "25 hours", "2 hours").await;

    // Flip the parent to committed first (valid pending → committed transition).
    sqlx::query(
        "UPDATE alert_evidence SET commit_status = 'committed', onchain_tx_sig = 'live' WHERE alert_id = $1",
    )
    .bind(alert_id)
    .execute(&pool)
    .await
    .expect("flip to committed");

    let ctx = CommitContext::new_for_test(pool.clone());
    // Run a tick; other tests may have eligible rows so we don't assert on the
    // global `scanned` count — instead we assert THIS alert was untouched.
    let _ = retry_once(&ctx).await.expect("retry tick");

    // Parent stays committed (terminal); the failure row was NOT abandoned by
    // the retry worker (its parent was excluded by the commit_status='pending'
    // JOIN gate).
    assert_eq!(commit_status(&pool, alert_id).await, "committed");
    let abandoned: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
        "SELECT abandoned_at FROM alert_evidence_commit_failures WHERE alert_id = $1",
    )
    .bind(alert_id)
    .fetch_one(&pool)
    .await
    .expect("read abandoned_at");
    assert!(
        abandoned.is_none(),
        "failure row with non-pending parent must be left untouched"
    );
}
