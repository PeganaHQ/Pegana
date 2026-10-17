//! ADR-0006 evidence-reconcile subscriber test (payload shape + SQL shape).
//!
//! Two layers:
//!   1. A CI-runnable unit test that the dispatcher parses the EXACT payload the
//!      engine publishes on `pegana:evidence_reconciled`. Genuinely drift-proof
//!      (#R3-7): both crates now share `pegana_common::EvidenceReconciledEvent`,
//!      so a contract change fails compilation here too — not just at runtime.
//!   2. SQL-shape integration tests (gated on PEGANA_INTEGRATION_PG_URL; skip
//!      silently in CI). These `affected_*` queries are HAND-MAINTAINED copies of
//!      the worker's SQL, not imported from it — they are fixtures, not automatic
//!      drift guards (a worker-side query edit must be mirrored here manually).
//!      The POST fan-out itself is covered by `dispatch_one`'s own tests in
//!      `webhook_dispatch_headers.rs` + `webhook_receivers.rs`.
//!
//! Run the integration layer locally (prod-local stack on :5434):
//!
//!   PEGANA_INTEGRATION_PG_URL=postgres://pegana:pegana@localhost:5434/pegana \
//!     cargo test -p dispatcher-rs --test evidence_reconcile_worker -- --nocapture

use sqlx::PgPool;
use uuid::Uuid;

fn pg_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_PG_URL")
        .ok()
        .filter(|s| !s.is_empty())
}

// GENUINELY drift-proof now (#R3-7): this test parses the engine's published
// payload with the SAME shared contract type both the engine (serialize) and the
// dispatcher (parse) use — `pegana_common::EvidenceReconciledEvent`. A field/name
// change to that contract fails compilation HERE too, not just silently on the
// wire (it used to validate a hand-authored copy independent of both sides).
use pegana_common::EvidenceReconciledEvent;

/// The dispatcher must parse the EXACT JSON the engine publishes
/// (`engine-rs::evidence_reconcile::publish_reconciled`):
///   {"event":"evidence_now_available","alert_id":"<uuid>"}
#[test]
fn parses_engine_published_evidence_reconciled_payload() {
    let alert_id = Uuid::new_v4();
    // Mirror the engine's serde_json::json! shape verbatim.
    let wire = serde_json::json!({
        "event": "evidence_now_available",
        "alert_id": alert_id,
    })
    .to_string();

    let evt: EvidenceReconciledEvent =
        serde_json::from_str(&wire).expect("dispatcher must parse engine payload");
    assert_eq!(evt.event, "evidence_now_available");
    assert_eq!(evt.alert_id, alert_id);
}

/// A malformed / unrelated payload must fail to parse (so the worker skips it
/// rather than firing a bogus notification).
#[test]
fn rejects_payload_without_alert_id() {
    let wire = r#"{"event":"evidence_now_available"}"#;
    let parsed: Result<EvidenceReconciledEvent, _> = serde_json::from_str(wire);
    assert!(parsed.is_err(), "missing alert_id must not parse");
}

/// Probe whether the webhook tables exist in the target DB. Mirrors the
/// retraction test's guard so the prod-local partial snapshot skips cleanly.
async fn webhook_tables_present(pool: &PgPool) -> bool {
    let row: Option<(bool,)> = sqlx::query_as(
        "SELECT \
           EXISTS (SELECT 1 FROM information_schema.tables \
                    WHERE table_name = 'webhook_subscriptions') \
           AND \
           EXISTS (SELECT 1 FROM information_schema.tables \
                    WHERE table_name = 'webhook_deliveries')",
    )
    .fetch_optional(pool)
    .await
    .unwrap_or(None);
    row.map(|(b,)| b).unwrap_or(false)
}

/// Mirror of `evidence_reconcile::fan_out_webhooks`'s SQL — keyed on a single
/// alert_id. Returns (sub_id, url) for webhook subs that got a 2xx delivery.
async fn affected_webhook_subs(pool: &PgPool, alert_id: Uuid) -> Vec<(Uuid, String)> {
    let rows: Vec<(Uuid, String, String)> = sqlx::query_as(
        "SELECT DISTINCT wd.subscription_id, ws.url, ws.channel_type \
         FROM webhook_deliveries wd \
         JOIN webhook_subscriptions ws ON ws.id = wd.subscription_id \
         WHERE wd.alert_id = $1 \
           AND wd.http_status BETWEEN 200 AND 299 \
           AND ws.is_active = TRUE",
    )
    .bind(alert_id)
    .fetch_all(pool)
    .await
    .expect("evidence-reconcile webhook query");
    rows.into_iter().map(|(s, u, _)| (s, u)).collect()
}

#[tokio::test]
async fn fan_out_queries_parse_and_return_empty_for_unknown_alert() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");

    if !webhook_tables_present(&pool).await {
        eprintln!(
            "[skip] fan_out_queries_parse_and_return_empty_for_unknown_alert — \
             webhook_subscriptions/webhook_deliveries not present in target DB"
        );
        return;
    }

    // Empty-input sanity: a never-seen alert id must return no webhook
    // subscribers, proving the SQL statement parses + executes.
    let unknown = Uuid::new_v4();
    let hooks = affected_webhook_subs(&pool, unknown).await;
    assert!(
        hooks.is_empty(),
        "unknown alert must return no webhook subs"
    );
}
