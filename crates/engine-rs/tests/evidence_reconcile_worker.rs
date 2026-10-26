//! ADR-0006 reconcile worker (`evidence_reconcile::reconcile_once`) against a
//! real Postgres. Seeds `alert_evidence_pending` rows via raw SQL, runs one
//! reconcile tick (the inner step function, no infinite loop), and asserts the
//! state transition:
//!
//!   * eligible pending row → promoted into `alert_evidence`, pending deleted;
//!   * pending row older than 24h → `failed_permanently_at` set (drives the
//!     API 410), not promoted.
//!
//! Gated on PEGANA_INTEGRATION_PG_URL. Skips silently in CI.
//!
//! Run locally (against prod-local stack on :5434):
//!   PEGANA_INTEGRATION_PG_URL=postgres://pegana:pegana@localhost:5434/pegana \
//!     cargo test -p engine-rs --test evidence_reconcile_worker -- --nocapture

use engine_rs::evidence_reconcile::reconcile_once;
use sqlx::PgPool;
use uuid::Uuid;

fn pg_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_PG_URL")
        .ok()
        .filter(|s| !s.is_empty())
}

/// Seed the parent `alerts` row (FK target for both pending + evidence).
async fn insert_alert(pool: &PgPool, alert_id: Uuid) {
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
}

/// Schema-versioned envelope identical to push_alert's pending fallback shape.
fn pending_payload(alert_id: Uuid) -> serde_json::Value {
    serde_json::json!({
        "schema": 1,
        "payload": {
            "alert_id": alert_id,
            "methodology_version": "0.1.0",
            "methodology_git_sha": "abc1234",
            "assets_toml_sha256": "a".repeat(64),
            "inputs_frozen": {"asset": "USDC"},
            "computed": {"final_state": "CRITICAL"},
            "replay_artifact": {"schema_version": "v1"},
            "receipt_sha256": "b".repeat(64),
            "commit_status": "not_applicable",
        },
    })
}

#[tokio::test]
async fn reconcile_promotes_pending_to_evidence() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    insert_alert(&pool, alert_id).await;

    // Eligible: last_attempted_at older than the 30s gate, queued recently.
    sqlx::query(
        "INSERT INTO alert_evidence_pending (alert_id, payload, queued_at, last_attempted_at, attempts) \
         VALUES ($1, $2, NOW(), NOW() - INTERVAL '60 seconds', 0)",
    )
    .bind(alert_id)
    .bind(pending_payload(alert_id))
    .execute(&pool)
    .await
    .expect("seed pending");

    // The worker scans all eligible pending rows (no per-alert_id filter), so a
    // concurrent test's tick may promote this row first — don't assert on the
    // racy global `recovered` count; assert THIS alert's outcome below.
    let _ = reconcile_once(&pool, None).await.expect("reconcile tick");

    // Audit row now exists.
    let ev: (String, String) = sqlx::query_as(
        "SELECT methodology_version, commit_status FROM alert_evidence WHERE alert_id = $1",
    )
    .bind(alert_id)
    .fetch_one(&pool)
    .await
    .expect("evidence row present");
    assert_eq!(ev.0, "0.1.0");
    assert_eq!(ev.1, "not_applicable");

    // Pending row deleted.
    let pend: Option<(Uuid,)> =
        sqlx::query_as("SELECT alert_id FROM alert_evidence_pending WHERE alert_id = $1")
            .bind(alert_id)
            .fetch_optional(&pool)
            .await
            .expect("pending lookup");
    assert!(
        pend.is_none(),
        "pending row should be deleted after promotion"
    );
}

#[tokio::test]
async fn reconcile_seeds_commit_retry_for_recovered_pending() {
    // Regression for the "stranded at commit_status='pending'" gap: a recovered
    // row that owed an on-chain commit must be handed to the dead-letter retry
    // worker (a commit_failures row), not left pending forever.
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    insert_alert(&pool, alert_id).await;

    // Same envelope but commit_status='pending' (a Critical alert that owed a commit).
    let mut payload = pending_payload(alert_id);
    payload["payload"]["commit_status"] = serde_json::json!("pending");

    sqlx::query(
        "INSERT INTO alert_evidence_pending (alert_id, payload, queued_at, last_attempted_at, attempts) \
         VALUES ($1, $2, NOW(), NOW() - INTERVAL '60 seconds', 0)",
    )
    .bind(alert_id)
    .bind(payload)
    .execute(&pool)
    .await
    .expect("seed pending");

    // Same rationale as reconcile_promotes_pending_to_evidence: the worker scans
    // all eligible rows, so don't assert the racy global `recovered` count —
    // assert THIS alert's outcome below.
    let _ = reconcile_once(&pool, None).await.expect("reconcile tick");

    // Evidence row promoted at commit_status='pending'.
    let ev: (String,) =
        sqlx::query_as("SELECT commit_status FROM alert_evidence WHERE alert_id = $1")
            .bind(alert_id)
            .fetch_one(&pool)
            .await
            .expect("evidence row present");
    assert_eq!(ev.0, "pending");

    // A commit_failures row was seeded so run_commit_failures_retry adopts it.
    let fail: Option<(String,)> = sqlx::query_as(
        "SELECT error_kind FROM alert_evidence_commit_failures WHERE alert_id = $1 AND abandoned_at IS NULL",
    )
    .bind(alert_id)
    .fetch_optional(&pool)
    .await
    .expect("commit_failures lookup");
    assert!(
        fail.is_some(),
        "recovered pending row must seed a commit_failures row, not strand at pending"
    );
}

#[tokio::test]
async fn reconcile_marks_failed_permanent_after_24h() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();
    insert_alert(&pool, alert_id).await;

    // Queued >24h ago and last attempted >30s ago → aged_out path.
    sqlx::query(
        "INSERT INTO alert_evidence_pending (alert_id, payload, queued_at, last_attempted_at, attempts) \
         VALUES ($1, $2, NOW() - INTERVAL '25 hours', NOW() - INTERVAL '60 seconds', 47)",
    )
    .bind(alert_id)
    .bind(pending_payload(alert_id))
    .execute(&pool)
    .await
    .expect("seed aged pending");

    // The worker scans all eligible rows, so a concurrent tick may mark this row
    // first — don't assert the racy global `failed_permanent` count; assert THIS
    // alert's outcome below.
    let _ = reconcile_once(&pool, None).await.expect("reconcile tick");

    // failed_permanently_at set; no audit row materialised (drives API 410).
    let row: (Option<chrono::DateTime<chrono::Utc>>,) = sqlx::query_as(
        "SELECT failed_permanently_at FROM alert_evidence_pending WHERE alert_id = $1",
    )
    .bind(alert_id)
    .fetch_one(&pool)
    .await
    .expect("pending still present");
    assert!(row.0.is_some(), "failed_permanently_at must be set");

    let ev: Option<(String,)> =
        sqlx::query_as("SELECT methodology_version FROM alert_evidence WHERE alert_id = $1")
            .bind(alert_id)
            .fetch_optional(&pool)
            .await
            .expect("evidence lookup");
    assert!(
        ev.is_none(),
        "aged-out row must NOT be promoted to evidence"
    );
}
