//! ADR-0020 ledger-gate verification. Black-box integration against a running
//! api-rs, mirroring the `audit_endpoint.rs` / `audit_state_filter.rs` harness.
//!
//! The gate: while `FEATURE_PUBLIC_ALERTS != true` the *discoverable* read
//! surface of the calibration ledger — the `GET /v1/audit` INDEX and the
//! CSV export built on it — returns an EMPTY list, keeping the dogfood window
//! quiet. The
//! by-id receipt lookup `GET /v1/audit/{id}` stays ungated (200) in BOTH
//! modes. The 2026-06-11 launch flips the flag and reveals the index.
//!
//! Because `AppState` lives in the api-rs *binary* crate (not importable from
//! an integration test), the flag can't be toggled in-process. Instead the
//! test reads the SAME `FEATURE_PUBLIC_ALERTS` env var the server booted with
//! and asserts the mode-appropriate contract — and the by-id 200 invariant in
//! both modes.
//!
//! Gated on PEGANA_INTEGRATION_API_BASE + PEGANA_INTEGRATION_PG_URL; skips
//! silently in CI without infra (same as the sibling test files).
//!
//! Run locally (standalone api-rs on :8088, prod-local DB stack on :5434):
//!   PEGANA_INTEGRATION_API_BASE=http://localhost:8088 \
//!   PEGANA_INTEGRATION_PG_URL=postgres://pegana:pegana@localhost:5434/pegana \
//!   FEATURE_PUBLIC_ALERTS=false \
//!     cargo test -p api-rs --test audit_ledger_gate -- --test-threads=1 --nocapture
//!
//! Flip `FEATURE_PUBLIC_ALERTS` (in BOTH the server env and this test's env)
//! to exercise the other branch.

use chrono::Utc;
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

/// The server's launch flag, as this test process sees it. The integration
/// runner sets it for both the api-rs binary and `cargo test`, so they agree.
/// Parsed leniently to match `envy`'s bool handling ("true"/"1" => true).
fn public_alerts() -> bool {
    matches!(
        std::env::var("FEATURE_PUBLIC_ALERTS")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "true" | "1"
    )
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("build reqwest client")
}

async fn seed_alert_at(pool: &PgPool, id: Uuid, to_state: &str) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO alerts (id, asset, class, from_state, to_state, discount,
                               intrinsic_usd, market_usd, confidence, detected_at, payload)
           VALUES ($1, 'USDC', 'stable_fiat'::asset_class, 'PEGGED'::peg_state, $2::peg_state,
                   0.001, 1.00, 0.999, 'high', $3, '{}'::jsonb)"#,
    )
    .bind(id)
    .bind(to_state)
    .bind(Utc::now())
    .execute(pool)
    .await?;
    Ok(())
}

async fn seed_evidence(pool: &PgPool, id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO alert_evidence
               (alert_id, methodology_version, assets_toml_sha256,
                inputs_frozen, computed, replay_artifact, receipt_sha256,
                commit_status, onchain_tx_sig)
           VALUES ($1, '0.1.0', repeat('a', 64),
                   '{"asset":"USDC"}'::jsonb, '{"final_state":"DRIFT"}'::jsonb,
                   NULL, repeat('b', 64), 'not_applicable', NULL)"#,
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Fetch a list endpoint and return the set of `id` strings it enumerates.
async fn id_set(base: &str, path: &str) -> Vec<String> {
    let resp = client()
        .get(format!("{base}{path}"))
        .send()
        .await
        .expect("send list request");
    assert_eq!(resp.status(), 200, "list endpoint {path} must be 200");
    let arr: Vec<Value> = resp.json().await.expect("json array");
    arr.iter()
        .filter_map(|r| r.get("id").and_then(|v| v.as_str()).map(String::from))
        .collect()
}

/// The discoverable INDEX (`/v1/audit`) is gated: empty during calibration,
/// enumerated once the flag flips. We seed a DRIFT alert and assert its
/// presence/absence according to the mode the server booted in.
#[tokio::test]
async fn audit_index_gated_by_public_alerts_flag() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");

    let id = Uuid::new_v4();
    seed_alert_at(&pool, id, "DRIFT").await.expect("seed alert");
    seed_evidence(&pool, id).await.expect("seed evidence");

    let ids = id_set(&base, "/v1/audit?limit=100").await;

    if public_alerts() {
        assert!(
            ids.contains(&id.to_string()),
            "FEATURE_PUBLIC_ALERTS=true: seeded DRIFT alert must appear in /v1/audit index"
        );
    } else {
        assert!(
            ids.is_empty(),
            "FEATURE_PUBLIC_ALERTS=false: /v1/audit index MUST be empty (ADR-0020 ledger gate), got {} rows",
            ids.len()
        );
        assert!(
            !ids.contains(&id.to_string()),
            "FEATURE_PUBLIC_ALERTS=false: seeded alert must NOT be discoverable via /v1/audit index"
        );
    }
}

/// The CSV export is the bulk-download face of the index, gated the same way:
/// header-only / empty body while the flag is false, populated when true. The
/// date-range 400 contract is independent of the flag, so a valid range is
/// always 200 here.
#[tokio::test]
async fn csv_export_gated_by_public_alerts_flag() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");

    let id = Uuid::new_v4();
    seed_alert_at(&pool, id, "DRIFT").await.expect("seed alert");
    seed_evidence(&pool, id).await.expect("seed evidence");

    // A 2-day window straddling "now" that comfortably covers the seed.
    let from = (Utc::now() - chrono::Duration::days(1)).to_rfc3339();
    let to = (Utc::now() + chrono::Duration::days(1)).to_rfc3339();
    let resp = client()
        .get(format!(
            "{base}/v1/audit.csv?from={}&to={}",
            urlencoding(&from),
            urlencoding(&to)
        ))
        .send()
        .await
        .expect("send csv request");
    assert_eq!(
        resp.status(),
        200,
        "valid CSV range must be 200 in both modes"
    );
    let body = resp.text().await.expect("csv body");

    if public_alerts() {
        assert!(
            body.contains(&id.to_string()),
            "FEATURE_PUBLIC_ALERTS=true: seeded alert must appear in /v1/audit.csv export"
        );
    } else {
        assert!(
            !body.contains(&id.to_string()),
            "FEATURE_PUBLIC_ALERTS=false: /v1/audit.csv MUST NOT enumerate the seeded alert (ADR-0020)"
        );
    }
}

/// Minimal RFC-3339 percent-encoding for the `+` in a timezone offset and the
/// `:` separators, which a bare query string would otherwise mangle.
fn urlencoding(s: &str) -> String {
    s.replace('+', "%2B").replace(':', "%3A")
}

/// The by-id detail lookup is NEVER gated (ADR-0020): a caller who already
/// knows an alert id — e.g. from a calibration-report link — can always
/// resolve and verify the receipt, in BOTH flag modes.
#[tokio::test]
async fn detail_by_id_always_200_regardless_of_flag() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = PgPool::connect(&pg).await.expect("connect pg");

    let id = Uuid::new_v4();
    seed_alert_at(&pool, id, "DRIFT").await.expect("seed alert");
    seed_evidence(&pool, id).await.expect("seed evidence");

    let resp = client()
        .get(format!("{base}/v1/audit/{id}"))
        .send()
        .await
        .expect("send detail request");
    assert_eq!(
        resp.status(),
        200,
        "GET /v1/audit/{{id}} must be 200 regardless of FEATURE_PUBLIC_ALERTS (ADR-0020)"
    );
    let body: Value = resp.json().await.expect("decode json");
    assert_eq!(
        body.pointer("/alert/id").and_then(|v| v.as_str()),
        Some(id.to_string().as_str()),
        "detail body must echo the requested alert id"
    );
}
