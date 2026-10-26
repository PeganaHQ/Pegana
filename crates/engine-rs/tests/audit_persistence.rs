//! End-to-end audit persistence: alerts ⋈ alert_evidence FK + JOIN.
//!
//! Validates that the schema from migrations 0028-0037 supports the
//! query pattern Phase 4 /v1/audit/:id will use:
//!     SELECT receipt_sha256, methodology_version, inputs_frozen, computed
//!     FROM alert_evidence WHERE alert_id = $1
//!
//! Gated on PEGANA_INTEGRATION_PG_URL. Skips silently in CI.
//!
//! Run locally:
//!   PEGANA_INTEGRATION_PG_URL=postgres://pegana:pegana@localhost:5434/pegana \
//!     cargo test -p engine-rs --test audit_persistence

use uuid::Uuid;

fn pg_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_PG_URL")
        .ok()
        .filter(|s| !s.is_empty())
}

#[tokio::test]
async fn alert_and_evidence_are_both_written() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();

    sqlx::query(
        r#"INSERT INTO alerts (id, asset, class, from_state, to_state, discount,
                               intrinsic_usd, market_usd, confidence, detected_at, payload)
           VALUES ($1, 'USDC', 'stable_fiat'::asset_class, 'PEGGED'::peg_state, 'DRIFT'::peg_state,
                   0.001, 1.00, 0.999, 'high', NOW(), '{}'::jsonb)"#,
    )
    .bind(alert_id)
    .execute(&pool)
    .await
    .expect("seed alerts");

    sqlx::query(
        r#"INSERT INTO alert_evidence
               (alert_id, methodology_version, assets_toml_sha256,
                inputs_frozen, computed, receipt_sha256)
           VALUES ($1, '0.1.0', repeat('a', 64),
                   '{"asset":"USDC"}'::jsonb, '{"final_state":"DRIFT"}'::jsonb,
                   repeat('b', 64))"#,
    )
    .bind(alert_id)
    .execute(&pool)
    .await
    .expect("seed evidence");

    let row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM alerts a \
         JOIN alert_evidence e ON e.alert_id = a.id \
         WHERE a.id = $1",
    )
    .bind(alert_id)
    .fetch_one(&pool)
    .await
    .expect("join query");
    assert_eq!(
        row.0, 1,
        "alerts ⋈ alert_evidence must yield exactly one row"
    );
}

#[tokio::test]
async fn audit_lookup_returns_full_receipt_fields() {
    // Validates the shape Phase 4's /v1/audit/:id will return.
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();

    sqlx::query(
        r#"INSERT INTO alerts (id, asset, class, from_state, to_state, discount,
                               intrinsic_usd, market_usd, confidence, detected_at, payload)
           VALUES ($1, 'USDe', 'stable_dn'::asset_class, 'PEGGED'::peg_state, 'CRITICAL'::peg_state,
                   0.05, 1.00, 0.95, 'high', NOW(), '{}'::jsonb)"#,
    )
    .bind(alert_id)
    .execute(&pool)
    .await
    .expect("seed alerts");

    sqlx::query(
        r#"INSERT INTO alert_evidence
               (alert_id, methodology_version, methodology_git_sha,
                assets_toml_sha256, inputs_frozen, computed, replay_artifact,
                receipt_sha256, commit_status)
           VALUES ($1, '0.1.0', 'abc1234',
                   repeat('a', 64),
                   '{"asset":"USDe","class":"stable_dn","alpha":"0.3"}'::jsonb,
                   '{"final_state":"CRITICAL","discount_smooth":"0.05"}'::jsonb,
                   '{"schema_version":"v1","methodology_version":"0.1.0"}'::jsonb,
                   repeat('b', 64),
                   'pending')"#,
    )
    .bind(alert_id)
    .execute(&pool)
    .await
    .expect("seed evidence");

    type ReceiptRow = (
        String,                                       // methodology_version
        String,                                       // assets_toml_sha256
        Option<String>,                               // methodology_git_sha
        String,                                       // receipt_sha256
        sqlx::types::Json<serde_json::Value>,         // inputs_frozen
        sqlx::types::Json<serde_json::Value>,         // computed
        Option<sqlx::types::Json<serde_json::Value>>, // replay_artifact
        String,                                       // commit_status
        String,                                       // onchain_tx_sig (COALESCEd to '')
    );
    let row: ReceiptRow = sqlx::query_as(
        "SELECT methodology_version, assets_toml_sha256, methodology_git_sha, \
                receipt_sha256, inputs_frozen, computed, replay_artifact, \
                commit_status, \
                COALESCE(onchain_tx_sig, '') \
         FROM alert_evidence WHERE alert_id = $1",
    )
    .bind(alert_id)
    .fetch_one(&pool)
    .await
    .expect("read receipt");

    assert_eq!(row.0, "0.1.0");
    assert_eq!(row.1.len(), 64, "assets_toml_sha256 is CHAR(64)");
    assert_eq!(row.2.as_deref(), Some("abc1234"));
    assert_eq!(row.3.len(), 64, "receipt_sha256 is CHAR(64)");
    assert_eq!(row.4 .0["asset"], "USDe");
    assert_eq!(row.5 .0["final_state"], "CRITICAL");
    assert!(row.6.is_some(), "critical alerts get replay_artifact");
    assert_eq!(
        row.7, "pending",
        "critical alerts INSERT with commit_status='pending' per Note 1"
    );
    assert_eq!(
        row.8, "",
        "onchain_tx_sig is NULL until commit_receipt persists it"
    );
}

#[tokio::test]
async fn critical_alert_with_commit_disabled_lands_as_not_applicable() {
    // Simulates the push_alert path when PEGANA_COMMIT_KEYPAIR is unset:
    // even a Critical-class alert must go in with commit_status='not_applicable'
    // (per the on_chain_enabled discrimination added after Wave 3B review),
    // so the row doesn't sit at 'pending' forever with no commit task spawned.
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let alert_id = Uuid::new_v4();

    sqlx::query(
        r#"INSERT INTO alerts (id, asset, class, from_state, to_state, discount,
                               intrinsic_usd, market_usd, confidence, detected_at, payload)
           VALUES ($1, 'USDe', 'stable_dn'::asset_class, 'PEGGED'::peg_state, 'CRITICAL'::peg_state,
                   0.05, 1.00, 0.95, 'high', NOW(), '{}'::jsonb)"#,
    )
    .bind(alert_id)
    .execute(&pool)
    .await
    .expect("seed alerts");

    // Critical alert but explicitly stored as not_applicable (commit disabled path).
    sqlx::query(
        r#"INSERT INTO alert_evidence
               (alert_id, methodology_version, assets_toml_sha256,
                inputs_frozen, computed, receipt_sha256, commit_status)
           VALUES ($1, '0.1.0', repeat('a', 64),
                   '{"asset":"USDe"}'::jsonb, '{"final_state":"CRITICAL"}'::jsonb,
                   repeat('b', 64), 'not_applicable')"#,
    )
    .bind(alert_id)
    .execute(&pool)
    .await
    .expect("insert with commit_status=not_applicable must succeed");

    let row: (String,) =
        sqlx::query_as("SELECT commit_status FROM alert_evidence WHERE alert_id = $1")
            .bind(alert_id)
            .fetch_one(&pool)
            .await
            .expect("read row");
    assert_eq!(
        row.0, "not_applicable",
        "commit-disabled path must land as terminal not_applicable"
    );

    // And confirm the trigger from 0033 holds — we cannot later advance this row.
    let err =
        sqlx::query("UPDATE alert_evidence SET commit_status = 'pending' WHERE alert_id = $1")
            .bind(alert_id)
            .execute(&pool)
            .await
            .expect_err("not_applicable is terminal");
    assert!(err.to_string().contains("terminal"), "got: {err}");
}

#[tokio::test]
async fn audit_lookup_returns_404_shape_for_unknown_alert() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let unknown = Uuid::new_v4();

    let row: Option<(String,)> =
        sqlx::query_as("SELECT methodology_version FROM alert_evidence WHERE alert_id = $1")
            .bind(unknown)
            .fetch_optional(&pool)
            .await
            .expect("lookup");
    assert!(
        row.is_none(),
        "unknown alert_id must return no row (Phase 4 returns 404)"
    );
}
