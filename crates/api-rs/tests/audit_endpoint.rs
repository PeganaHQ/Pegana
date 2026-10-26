//! AC16-AC25 verification. Black-box integration against running api-rs.
//!
//! Gated on PEGANA_INTEGRATION_API_BASE + PEGANA_INTEGRATION_PG_URL.
//! Skips silently in CI without infra.
//!
//! Run locally (standalone api-rs on :8088, prod-local DB stack on :5434):
//!   PEGANA_INTEGRATION_API_BASE=http://localhost:8088 \
//!   PEGANA_INTEGRATION_PG_URL=postgres://pegana:pegana@localhost:5434/pegana \
//!     cargo test -p api-rs --test audit_endpoint -- --test-threads=1 --nocapture
//!
//! Coverage (14 cases, mapped to ADR-0006 and ADR-0014):
//!   Happy path (4):  receipt detail, replay-bundle download, index sorting,
//!                    CSV streaming.
//!   Negative  (4):   invalid UUID 400, unknown 404, missing replay 404 with
//!                    hint, onchain pending 404.
//!   ADR-0006  (3):   pending → 202 with Retry-After; failed_permanent → 410
//!                    with last_error; evidence-wins-over-pending precedence.
//!   ADR-0014  (3):   CSV >90d → 400; CSV to<from → 400; index limit capped 100.
//!
//! Cleanup is best-effort: `alert_evidence` has an append-only trigger
//! blocking DELETE, and `alerts` has FKs from both `alert_evidence` and
//! `alert_evidence_pending`. We only DELETE from `alert_evidence_pending`
//! (no trigger). Test isolation relies on fresh Uuid::new_v4() per case.

use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

fn base() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_API_BASE")
        .ok()
        .filter(|s| !s.is_empty())
}
fn pg_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_PG_URL")
        .ok()
        .filter(|s| !s.is_empty())
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("build reqwest client")
}

/// Insert an `alerts` row at a given `detected_at`. Returns nothing — the
/// caller already owns the chosen id. The asset symbol must already exist
/// in `assets` (FK); USDC is always present in the seed data.
async fn seed_alert_at(
    pool: &PgPool,
    id: Uuid,
    to_state: &str,
    detected_at: DateTime<Utc>,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO alerts (id, asset, class, from_state, to_state, discount,
                               intrinsic_usd, market_usd, confidence, detected_at, payload)
           VALUES ($1, 'USDC', 'stable_fiat'::asset_class, 'PEGGED'::peg_state, $2::peg_state,
                   0.001, 1.00, 0.999, 'high', $3, '{}'::jsonb)"#,
    )
    .bind(id)
    .bind(to_state)
    .bind(detected_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Insert an `alert_evidence` row for an existing alert. `with_artifact`
/// distinguishes the DRIFT (no replay) and CRITICAL (replay JSONB) paths
/// the handlers branch on.
async fn seed_evidence(pool: &PgPool, id: Uuid, with_artifact: bool) -> sqlx::Result<()> {
    // commit_status defaults to 'not_applicable' (migration 0033) — same as a
    // Drift transition that is intentionally never anchored.
    seed_evidence_commit(pool, id, with_artifact, "not_applicable", None).await
}

/// Seed an `alert_evidence` row with an explicit `commit_status` (and optional
/// on-chain signature). The append-only trigger (migration 0033) only guards
/// UPDATEs, so any valid status may be set at INSERT time.
async fn seed_evidence_commit(
    pool: &PgPool,
    id: Uuid,
    with_artifact: bool,
    commit_status: &str,
    tx_sig: Option<&str>,
) -> sqlx::Result<()> {
    let artifact: Option<Value> = if with_artifact {
        Some(serde_json::json!({"schema_version": "v1", "alert_id": id.to_string()}))
    } else {
        None
    };
    sqlx::query(
        r#"INSERT INTO alert_evidence
               (alert_id, methodology_version, assets_toml_sha256,
                inputs_frozen, computed, replay_artifact, receipt_sha256,
                commit_status, onchain_tx_sig)
           VALUES ($1, '0.1.0', repeat('a', 64),
                   '{"asset":"USDC"}'::jsonb, '{"final_state":"DRIFT"}'::jsonb,
                   $2, repeat('b', 64), $3, $4)"#,
    )
    .bind(id)
    .bind(artifact)
    .bind(commit_status)
    .bind(tx_sig)
    .execute(pool)
    .await?;
    Ok(())
}

/// Seed an `alert_evidence_pending` row simulating ADR-0006's dead-letter
/// queue. `failed_at` Some => terminal (410 path); None => still retrying
/// (202 path). `last_error` mirrors what the retry loop would record.
async fn seed_pending(
    pool: &PgPool,
    id: Uuid,
    last_error: Option<&str>,
    failed_at: Option<DateTime<Utc>>,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO alert_evidence_pending (alert_id, payload, last_error, failed_permanently_at) \
         VALUES ($1, '{\"schema\":1}'::jsonb, $2, $3)",
    )
    .bind(id)
    .bind(last_error)
    .bind(failed_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Best-effort cleanup. We can only DELETE from `alert_evidence_pending`
/// (the other tables have append-only triggers or FK chains that block
/// removal). Stale rows from test runs are tagged with fresh UUIDs and
/// quietly accumulate — `alerts` is partition-scanned by detected_at so
/// the cost is negligible.
async fn cleanup(pool: &PgPool, alert_id: Uuid) {
    let _ = sqlx::query("DELETE FROM alert_evidence_pending WHERE alert_id = $1")
        .bind(alert_id)
        .execute(pool)
        .await;
}

// ─── Happy path (4) ─────────────────────────────────────────────────────

#[tokio::test]
async fn seeded_alert_returns_200_with_full_receipt() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");
    let id = Uuid::new_v4();
    seed_alert_at(&pool, id, "DRIFT", Utc::now())
        .await
        .expect("seed alert");
    seed_evidence(&pool, id, false)
        .await
        .expect("seed evidence");

    let resp = client()
        .get(format!("{base}/v1/audit/{id}"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 200, "expected 200 for seeded alert");
    let body: Value = resp.json().await.expect("decode json");

    assert_eq!(
        body.pointer("/alert/id").and_then(|v| v.as_str()),
        Some(id.to_string().as_str())
    );
    assert_eq!(
        body.pointer("/alert/asset").and_then(|v| v.as_str()),
        Some("USDC")
    );
    assert_eq!(
        body.pointer("/evidence/methodology_version")
            .and_then(|v| v.as_str()),
        Some("0.1.0")
    );
    let sha = body
        .pointer("/evidence/receipt_sha256")
        .and_then(|v| v.as_str())
        .expect("receipt_sha256 present");
    assert_eq!(sha.len(), 64, "receipt_sha256 is CHAR(64)");
    assert_eq!(
        body.pointer("/evidence/has_replay_artifact")
            .and_then(|v| v.as_bool()),
        Some(false),
        "DRIFT seed has no replay_artifact"
    );
    assert_eq!(
        body.get("evidence_status").and_then(|v| v.as_str()),
        Some("ready")
    );

    cleanup(&pool, id).await;
}

#[tokio::test]
async fn seeded_critical_alert_has_replay_bundle() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");
    let id = Uuid::new_v4();
    seed_alert_at(&pool, id, "CRITICAL", Utc::now())
        .await
        .expect("seed alert");
    seed_evidence(&pool, id, true).await.expect("seed evidence");

    let resp = client()
        .get(format!("{base}/v1/audit/{id}/replay-bundle"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 200);
    let disp = resp
        .headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    assert!(
        disp.contains("attachment"),
        "expected attachment disposition"
    );
    assert!(
        disp.contains(&id.to_string()),
        "Content-Disposition must include alert_id, got: {disp}"
    );

    let body: Value = resp.json().await.expect("decode json");
    assert_eq!(
        body.get("schema_version").and_then(|v| v.as_str()),
        Some("v1")
    );
    assert_eq!(
        body.get("alert_id").and_then(|v| v.as_str()),
        Some(id.to_string().as_str())
    );

    cleanup(&pool, id).await;
}

#[tokio::test]
async fn index_returns_seeded_alerts_recent_first() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");

    // Three alerts at controlled, decreasing timestamps so we can verify
    // ordering. Push them well into the past to keep them off the live
    // page-1 hot-set if the local DB has organic data; we just check they
    // appear in the returned (large) array somewhere with the right shape.
    let now = Utc::now();
    let old = Uuid::new_v4();
    let mid = Uuid::new_v4();
    let new = Uuid::new_v4();
    seed_alert_at(&pool, old, "PEGGED", now - Duration::hours(3))
        .await
        .expect("seed old");
    seed_alert_at(&pool, mid, "DRIFT", now - Duration::hours(2))
        .await
        .expect("seed mid");
    seed_alert_at(&pool, new, "DRIFT", now - Duration::hours(1))
        .await
        .expect("seed new");
    seed_evidence(&pool, old, false).await.expect("seed old ev");
    seed_evidence(&pool, mid, false).await.expect("seed mid ev");
    seed_evidence(&pool, new, false).await.expect("seed new ev");

    // Default exclude_pegged=true → PEGGED row must NOT appear.
    let resp = client()
        .get(format!("{base}/v1/audit?limit=100"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 200);
    let arr: Vec<Value> = resp.json().await.expect("json array");
    assert!(arr.len() <= 100, "limit clamp respected");

    let ids: Vec<String> = arr
        .iter()
        .filter_map(|r| r.get("id").and_then(|v| v.as_str()).map(String::from))
        .collect();
    assert!(
        ids.contains(&mid.to_string()),
        "mid (DRIFT) must appear in default index"
    );
    assert!(
        ids.contains(&new.to_string()),
        "new (DRIFT) must appear in default index"
    );
    assert!(
        !ids.contains(&old.to_string()),
        "old (PEGGED) must be filtered when exclude_pegged=true (default)"
    );

    // Among our two visible IDs, `new` must come strictly before `mid`
    // because the index orders by detected_at DESC.
    let pos_new = ids.iter().position(|x| x == &new.to_string()).unwrap();
    let pos_mid = ids.iter().position(|x| x == &mid.to_string()).unwrap();
    assert!(
        pos_new < pos_mid,
        "newer alert must precede older (recent-first)"
    );

    // With exclude_pegged=false, the PEGGED row must reappear.
    let resp2 = client()
        .get(format!("{base}/v1/audit?limit=100&exclude_pegged=false"))
        .send()
        .await
        .expect("send2");
    assert_eq!(resp2.status(), 200);
    let arr2: Vec<Value> = resp2.json().await.expect("json2");
    let ids2: Vec<String> = arr2
        .iter()
        .filter_map(|r| r.get("id").and_then(|v| v.as_str()).map(String::from))
        .collect();
    assert!(
        ids2.contains(&old.to_string()),
        "PEGGED row must reappear when exclude_pegged=false"
    );

    cleanup(&pool, old).await;
    cleanup(&pool, mid).await;
    cleanup(&pool, new).await;
}

#[tokio::test]
async fn csv_streams_seeded_rows() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");

    let now = Utc::now();
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    seed_alert_at(&pool, a, "DRIFT", now - Duration::minutes(30))
        .await
        .expect("seed a");
    seed_alert_at(&pool, b, "DRIFT", now - Duration::minutes(15))
        .await
        .expect("seed b");
    seed_evidence(&pool, a, false).await.expect("ev a");
    seed_evidence(&pool, b, false).await.expect("ev b");

    let from = (now - Duration::hours(2)).to_rfc3339();
    let to = (now + Duration::minutes(5)).to_rfc3339();
    let resp = client()
        .get(format!("{base}/v1/audit.csv"))
        .query(&[("from", from.as_str()), ("to", to.as_str())])
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 200);
    let ctype = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(
        ctype.starts_with("text/csv"),
        "expected text/csv, got: {ctype}"
    );
    let body = resp.text().await.expect("body text");
    assert!(
        body.contains(&a.to_string()),
        "csv body must contain seeded alert_id a"
    );
    assert!(
        body.contains(&b.to_string()),
        "csv body must contain seeded alert_id b"
    );

    cleanup(&pool, a).await;
    cleanup(&pool, b).await;
}

// ─── Negative path (4) ──────────────────────────────────────────────────

#[tokio::test]
async fn invalid_uuid_returns_400() {
    let Some(base) = base() else { return };
    let resp = client()
        .get(format!("{base}/v1/audit/not-a-uuid"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("error").and_then(|v| v.as_str()),
        Some("invalid_uuid")
    );
}

#[tokio::test]
async fn unknown_alert_returns_404() {
    let Some(base) = base() else { return };
    let id = Uuid::new_v4();
    let resp = client()
        .get(format!("{base}/v1/audit/{id}"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("error").and_then(|v| v.as_str()),
        Some("alert_not_found")
    );
}

#[tokio::test]
async fn alert_without_evidence_returns_404_evidence_missing() {
    // P3-B from Wave 4 review: distinguish "alert exists but evidence + pending
    // both missing" (rare push_alert dual-failure) from "alert_id never observed".
    let Some(base) = base() else { return };
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
    .expect("seed alerts row only — no evidence, no pending");

    let resp = client()
        .get(format!("{base}/v1/audit/{alert_id}"))
        .send()
        .await
        .expect("GET");
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("error").and_then(|v| v.as_str()),
        Some("evidence_missing"),
        "got: {body:?}"
    );
    assert!(
        body.get("hint")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .contains("alert row exists"),
        "hint should explain the dual-failure case; got: {body:?}"
    );
}

#[tokio::test]
async fn no_replay_artifact_returns_404_with_hint() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");
    let id = Uuid::new_v4();
    seed_alert_at(&pool, id, "DRIFT", Utc::now())
        .await
        .expect("seed alert");
    seed_evidence(&pool, id, false).await.expect("seed ev");

    let resp = client()
        .get(format!("{base}/v1/audit/{id}/replay-bundle"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("error").and_then(|v| v.as_str()),
        Some("no_replay_artifact")
    );
    // The hint used to blame DRIFT, but DRIFT receipts do carry bundles; it now
    // points at the receipt instead, and the envelope carries `message`.
    let hint = body.get("hint").and_then(|v| v.as_str()).unwrap_or("");
    assert!(
        hint.contains(&format!("/v1/audit/{id}")),
        "hint must point at the receipt, got: {hint}"
    );
    assert!(body.get("message").and_then(|v| v.as_str()).is_some());

    cleanup(&pool, id).await;
}

#[tokio::test]
async fn replay_bundle_for_unknown_alert_is_alert_not_found() {
    let Some(base) = base() else { return };
    let id = Uuid::new_v4();
    let resp = client()
        .get(format!("{base}/v1/audit/{id}/replay-bundle"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("error").and_then(|v| v.as_str()),
        Some("alert_not_found"),
        "got: {body:?}"
    );
}

// ─── B-005: /onchain discriminates WHY a receipt is not anchored ─────────
// A NULL tx_sig is no longer collapsed into a single "not_committed_yet".
// commit_status separates "never anchored by design" (not_applicable) from
// "in flight" (pending) and the two failure terminals. All stay 404.

#[tokio::test]
async fn onchain_not_applicable_returns_404_not_applicable() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");
    let id = Uuid::new_v4();
    // A Drift transition: cost-gated, never anchored (ADR-0004).
    seed_alert_at(&pool, id, "DRIFT", Utc::now())
        .await
        .expect("seed alert");
    seed_evidence_commit(&pool, id, true, "not_applicable", None)
        .await
        .expect("seed ev");

    let resp = client()
        .get(format!("{base}/v1/audit/{id}/onchain"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("error").and_then(|v| v.as_str()),
        Some("not_applicable"),
        "a never-anchored alert must not read as not_committed_yet"
    );
    assert_eq!(
        body.get("commit_status").and_then(|v| v.as_str()),
        Some("not_applicable")
    );

    cleanup(&pool, id).await;
}

#[tokio::test]
async fn onchain_pending_returns_404_not_committed_yet() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");
    let id = Uuid::new_v4();
    // A Critical transition whose commit is genuinely in flight.
    seed_alert_at(&pool, id, "CRITICAL", Utc::now())
        .await
        .expect("seed alert");
    seed_evidence_commit(&pool, id, true, "pending", None)
        .await
        .expect("seed ev");

    let resp = client()
        .get(format!("{base}/v1/audit/{id}/onchain"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("error").and_then(|v| v.as_str()),
        Some("not_committed_yet")
    );
    assert_eq!(
        body.get("commit_status").and_then(|v| v.as_str()),
        Some("pending")
    );

    cleanup(&pool, id).await;
}

#[tokio::test]
async fn onchain_committed_returns_200_with_sig() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");
    let id = Uuid::new_v4();
    let sig = "5".repeat(88); // shape of a base58 Solana signature
    seed_alert_at(&pool, id, "DEPEG", Utc::now())
        .await
        .expect("seed alert");
    seed_evidence_commit(&pool, id, true, "committed", Some(&sig))
        .await
        .expect("seed ev");

    let resp = client()
        .get(format!("{base}/v1/audit/{id}/onchain"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("tx_sig").and_then(|v| v.as_str()),
        Some(sig.as_str())
    );
    assert_eq!(
        body.get("commit_status").and_then(|v| v.as_str()),
        Some("committed")
    );
    assert!(body
        .get("explorer_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .contains("solscan.io"));

    cleanup(&pool, id).await;
}

#[tokio::test]
async fn onchain_retry_exhausted_returns_404_retry_exhausted() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");
    let id = Uuid::new_v4();
    seed_alert_at(&pool, id, "CRITICAL", Utc::now())
        .await
        .expect("seed alert");
    seed_evidence_commit(&pool, id, true, "retry_exhausted", None)
        .await
        .expect("seed ev");

    let resp = client()
        .get(format!("{base}/v1/audit/{id}/onchain"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("error").and_then(|v| v.as_str()),
        Some("retry_exhausted"),
        "an exhausted commit must surface its own discriminator, not not_committed_yet"
    );
    assert_eq!(
        body.get("commit_status").and_then(|v| v.as_str()),
        Some("retry_exhausted")
    );

    cleanup(&pool, id).await;
}

#[tokio::test]
async fn onchain_wallet_drained_returns_404_wallet_drained() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");
    let id = Uuid::new_v4();
    seed_alert_at(&pool, id, "DEPEG", Utc::now())
        .await
        .expect("seed alert");
    seed_evidence_commit(&pool, id, true, "wallet_drained", None)
        .await
        .expect("seed ev");

    let resp = client()
        .get(format!("{base}/v1/audit/{id}/onchain"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("error").and_then(|v| v.as_str()),
        Some("wallet_drained")
    );
    assert_eq!(
        body.get("commit_status").and_then(|v| v.as_str()),
        Some("wallet_drained")
    );

    cleanup(&pool, id).await;
}

// The `None` branch: no alert_evidence row AND no dead-letter row — a genuinely
// unknown alert id. Must read as not_committed_yet/unknown (never confirming).
#[tokio::test]
async fn onchain_unknown_alert_returns_404_unknown() {
    let Some(base) = base() else { return };
    let id = Uuid::new_v4(); // never seeded

    let resp = client()
        .get(format!("{base}/v1/audit/{id}/onchain"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("error").and_then(|v| v.as_str()),
        Some("not_committed_yet")
    );
    assert_eq!(
        body.get("commit_status").and_then(|v| v.as_str()),
        Some("unknown")
    );
}

// B-005 dead-letter parity: when the receipt never materialized but a
// dead-letter row exists, /onchain must agree with /detail on MEANING. HTTP
// stays 404 (CLI 404-skip contract) but commit_status reflects persistence.
#[tokio::test]
async fn onchain_dead_letter_pending_returns_404_pending_persistence() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");
    let id = Uuid::new_v4();
    // Alert + pending row, NO alert_evidence, still retrying (failed_at NULL).
    seed_alert_at(&pool, id, "CRITICAL", Utc::now())
        .await
        .expect("seed alert");
    seed_pending(&pool, id, Some("transient: deadlock"), None)
        .await
        .expect("seed pending");

    let resp = client()
        .get(format!("{base}/v1/audit/{id}/onchain"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 404, "dead-letter states stay 404 by design");
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("error").and_then(|v| v.as_str()),
        Some("not_committed_yet")
    );
    assert_eq!(
        body.get("commit_status").and_then(|v| v.as_str()),
        Some("pending_persistence"),
        "a still-retrying receipt must read as pending persistence, not bare unknown"
    );

    cleanup(&pool, id).await;
}

#[tokio::test]
async fn onchain_dead_letter_failed_returns_404_persistence_failed() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");
    let id = Uuid::new_v4();
    // Alert + pending row, NO alert_evidence, terminal (failed_permanently_at set).
    seed_alert_at(&pool, id, "CRITICAL", Utc::now())
        .await
        .expect("seed alert");
    seed_pending(&pool, id, Some("permanent: pg disk full"), Some(Utc::now()))
        .await
        .expect("seed pending");

    let resp = client()
        .get(format!("{base}/v1/audit/{id}/onchain"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 404, "dead-letter states stay 404 by design");
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("error").and_then(|v| v.as_str()),
        Some("persistence_failed"),
        "a permanently-failed receipt must NOT read as not_committed_yet ('try again')"
    );
    assert_eq!(
        body.get("commit_status").and_then(|v| v.as_str()),
        Some("failed_permanent")
    );

    cleanup(&pool, id).await;
}

// ─── ADR-0006 (3) — 202 / 410 / evidence-wins-precedence ────────────────

#[tokio::test]
async fn pending_evidence_returns_202_with_retry_after() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");
    let id = Uuid::new_v4();
    // Seed alert + pending row WITHOUT alert_evidence — simulates a fresh
    // dispatch where the synchronous INSERT failed and the dead-letter
    // retry hasn't fired yet (failed_permanently_at IS NULL).
    seed_alert_at(&pool, id, "DRIFT", Utc::now())
        .await
        .expect("seed alert");
    seed_pending(&pool, id, Some("transient: deadlock"), None)
        .await
        .expect("seed pending");

    let resp = client()
        .get(format!("{base}/v1/audit/{id}"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 202, "pending must surface as 202 Accepted");

    let retry_after = resp
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert_eq!(retry_after, "60", "Retry-After header must be 60");

    let body: Value = resp.json().await.expect("json");
    assert_eq!(body.get("status").and_then(|v| v.as_str()), Some("pending"));
    assert_eq!(
        body.get("retry_after_seconds").and_then(|v| v.as_i64()),
        Some(60)
    );
    assert_eq!(
        body.get("evidence_status").and_then(|v| v.as_str()),
        Some("pending")
    );
    assert!(
        body.get("alert_dispatched_at").is_some(),
        "alert_dispatched_at must be present for triage"
    );

    cleanup(&pool, id).await;
}

#[tokio::test]
async fn failed_permanent_returns_410_with_last_error() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");
    let id = Uuid::new_v4();
    seed_alert_at(&pool, id, "DRIFT", Utc::now())
        .await
        .expect("seed alert");
    seed_pending(&pool, id, Some("disk full"), Some(Utc::now()))
        .await
        .expect("seed failed_permanent");

    let resp = client()
        .get(format!("{base}/v1/audit/{id}"))
        .send()
        .await
        .expect("send");
    assert_eq!(
        resp.status(),
        410,
        "failed_permanent must surface as 410 Gone"
    );

    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("status").and_then(|v| v.as_str()),
        Some("persistence_failed")
    );
    assert_eq!(
        body.get("last_error").and_then(|v| v.as_str()),
        Some("persistence_failed"),
        "the raw error text must not be served"
    );
    assert_eq!(
        body.get("evidence_status").and_then(|v| v.as_str()),
        Some("failed_permanent")
    );

    cleanup(&pool, id).await;
}

#[tokio::test]
async fn evidence_present_wins_over_pending() {
    // Race scenario: synchronous INSERT failed → pending row enqueued →
    // retry worker eventually succeeded → real alert_evidence row landed,
    // but the pending row hasn't been cleaned up yet. Detail must return
    // 200 (canonical receipt path) and ignore the stale pending row.
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");
    let id = Uuid::new_v4();
    seed_alert_at(&pool, id, "DRIFT", Utc::now())
        .await
        .expect("seed alert");
    seed_pending(&pool, id, Some("was transient, now resolved"), None)
        .await
        .expect("seed pending");
    seed_evidence(&pool, id, false)
        .await
        .expect("seed real evidence");

    let resp = client()
        .get(format!("{base}/v1/audit/{id}"))
        .send()
        .await
        .expect("send");
    assert_eq!(
        resp.status(),
        200,
        "alert_evidence presence must override pending row"
    );
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("evidence_status").and_then(|v| v.as_str()),
        Some("ready")
    );
    assert_eq!(
        body.pointer("/evidence/methodology_version")
            .and_then(|v| v.as_str()),
        Some("0.1.0")
    );

    cleanup(&pool, id).await;
}

// ─── ADR-0014 (3) — bounds ──────────────────────────────────────────────

#[tokio::test]
async fn csv_over_90_days_returns_400() {
    let Some(base) = base() else { return };
    let resp = client()
        .get(format!("{base}/v1/audit.csv"))
        .query(&[
            ("from", "2024-01-01T00:00:00Z"),
            ("to", "2026-01-01T00:00:00Z"),
        ])
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("error").and_then(|v| v.as_str()),
        Some("date_range_too_large")
    );
    assert_eq!(body.get("max_days").and_then(|v| v.as_i64()), Some(90));
}

#[tokio::test]
async fn csv_to_before_from_returns_400() {
    let Some(base) = base() else { return };
    let resp = client()
        .get(format!("{base}/v1/audit.csv"))
        .query(&[
            ("from", "2026-05-02T00:00:00Z"),
            ("to", "2026-05-01T00:00:00Z"),
        ])
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.expect("json");
    assert_eq!(
        body.get("error").and_then(|v| v.as_str()),
        Some("invalid_date_range")
    );
}

#[tokio::test]
async fn index_limit_capped_at_100() {
    let Some(base) = base() else { return };
    let resp = client()
        .get(format!("{base}/v1/audit?limit=500"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 200);
    let arr: Vec<Value> = resp.json().await.expect("json");
    assert!(
        arr.len() <= 100,
        "index must clamp limit to 100 (got {})",
        arr.len()
    );
}

/// Round-3 F4: a receipt is cached `immutable` only once its on-chain fields
/// are final. A `pending` commit gets `max-age=60`; the same receipt once
/// committed (status + signature) gets the one-year immutable header.
#[tokio::test]
async fn receipt_cache_is_short_until_the_commit_settles() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");
    let cc = |resp: &reqwest::Response| {
        resp.headers()
            .get("cache-control")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string()
    };

    let pending = Uuid::new_v4();
    seed_alert_at(&pool, pending, "DEPEG", Utc::now())
        .await
        .expect("seed alert");
    seed_evidence_commit(&pool, pending, false, "pending", None)
        .await
        .expect("seed ev");
    let resp = client()
        .get(format!("{base}/v1/audit/{pending}"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 200);
    let got = cc(&resp);
    assert_eq!(got, "public, max-age=60", "pending receipt: {got}");

    // The worker's success path: pending -> committed + signature.
    let sig = "5".repeat(88);
    sqlx::query(
        "UPDATE alert_evidence SET commit_status = 'committed', onchain_tx_sig = $1 \
         WHERE alert_id = $2",
    )
    .bind(&sig)
    .bind(pending)
    .execute(&pool)
    .await
    .expect("commit");
    let resp = client()
        .get(format!("{base}/v1/audit/{pending}"))
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 200);
    let got = cc(&resp);
    assert!(got.contains("immutable"), "committed receipt: {got}");

    // A never-anchored (not_applicable) receipt is final at once.
    let drift = Uuid::new_v4();
    seed_alert_at(&pool, drift, "DRIFT", Utc::now())
        .await
        .expect("seed alert");
    seed_evidence(&pool, drift, false).await.expect("seed ev");
    let resp = client()
        .get(format!("{base}/v1/audit/{drift}"))
        .send()
        .await
        .expect("send");
    assert!(cc(&resp).contains("immutable"));

    cleanup(&pool, pending).await;
    cleanup(&pool, drift).await;
}
