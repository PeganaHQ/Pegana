//! Pipeline integration tests — Redis source publish → engine recompute
//! → Postgres discount_snapshots row → optional alert in `alerts`.
//!
//! These tests run against an EXISTING prod-local stack (real engine
//! running in `pegana-prodlocal-engine-1`), exercising the full
//! recompute path without spawning new containers.
//!
//! Gated by three env vars; missing any short-circuits to a no-op. The
//! PEGANA_E2E_STACK flag asserts the full prod-local stack (incl. a running
//! engine) is up — CI sets DB+Redis but NOT this, so CI skips these
//! full-pipeline tests instead of failing on "engine has never written":
//!
//!   PEGANA_E2E_STACK=1
//!   PEGANA_INTEGRATION_DB=postgres://pegana:pegana@localhost:5434/pegana
//!   PEGANA_INTEGRATION_REDIS=redis://localhost:6381
//!
//! Local run (against the prod-local stack with the engine container up):
//!
//!   PEGANA_E2E_STACK=1 \
//!   PEGANA_INTEGRATION_DB=postgres://pegana:pegana@localhost:5434/pegana \
//!   PEGANA_INTEGRATION_REDIS=redis://localhost:6381 \
//!     cargo test -p api-rs --test engine_pipeline -- --nocapture
//!
//! Why this lives in `api-rs/tests/` and not a dedicated crate:
//! - The api-rs test target already has sqlx + redis + chrono +
//!   serde_json wired. Adding a separate crate would duplicate the
//!   dependency graph for two short tests.
//! - The pattern (env-var-gated black-box) matches the existing
//!   http_endpoints.rs suite — same skip behavior in CI.
//!
//! testcontainers-rs was considered. Skipped because the prod-local
//! stack is the canonical dev environment per project memory; running
//! a parallel container set just to test means the tests would diverge
//! from how operators actually verify changes.

use chrono::Utc;
use redis::AsyncCommands;
use rust_decimal::Decimal;
use serde_json::json;
use sqlx::{PgPool, Row};
use std::str::FromStr;
use std::time::Duration;
use tokio::time::sleep;

fn db_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_DB")
        .ok()
        .filter(|s| !s.is_empty())
}

fn redis_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_REDIS")
        .ok()
        .filter(|s| !s.is_empty())
}

/// These tests need the REAL engine actively recomputing (prod-local
/// `pegana-prodlocal-engine-1`), not just a Postgres + Redis pair. CI stands
/// up Postgres + Redis (so the schema-only integration suites run) but does
/// NOT run the engine, so gating on DB+Redis alone made these fail in CI with
/// "engine has never written / is the stack up?". Require an explicit
/// `PEGANA_E2E_STACK=1` that only the prod-local runner sets, so CI skips
/// these full-pipeline tests while still enforcing fmt/clippy/check + the
/// schema-only integration tests.
fn stack_up() -> bool {
    std::env::var("PEGANA_E2E_STACK")
        .ok()
        .filter(|s| !s.is_empty())
        .is_some()
}

async fn fixtures() -> Option<(PgPool, redis::Client)> {
    if !stack_up() {
        return None;
    }
    let (Some(dsn), Some(redis_dsn)) = (db_url(), redis_url()) else {
        return None;
    };
    let pg = PgPool::connect(&dsn).await.expect("connect pg");
    let redis = redis::Client::open(redis_dsn).expect("redis client");
    Some((pg, redis))
}

/// Probe: publish a Sanctum-shaped intrinsic reading for jitoSOL, wait
/// briefly for the engine to recompute, then confirm a new
/// `discount_snapshots` row landed for that asset.
///
/// This exercises the full path: indexer envelope shape → engine
/// `handle_message` → `derive_intrinsic` cache → `try_recompute` →
/// `persist_discount`. If any of those break, the row never appears.
#[tokio::test]
async fn sanctum_publish_lands_a_discount_snapshot() {
    let Some((pg, redis_client)) = fixtures().await else {
        return;
    };

    // Baseline: how many snapshots exist for jitoSOL right now?
    let baseline: i64 =
        sqlx::query_scalar("SELECT count(*) FROM discount_snapshots WHERE asset = 'jitoSOL'")
            .fetch_one(&pg)
            .await
            .expect("count baseline");

    // Synthetic Sanctum intrinsic payload. The engine treats
    // SRC_SANCTUM/SOLAYER/PIGGYBANK as a generic per-asset envelope:
    // { asset, value_usd }.
    let mut conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .expect("redis conn");
    let payload = json!({
        "asset": "jitoSOL",
        "value_usd": "200.123456",
        "ts": Utc::now(),
    });
    let _: i64 = conn
        .publish("pegana:src:sanctum", payload.to_string())
        .await
        .expect("publish");

    // Engine recompute is sub-second when the market side is fresh.
    // 3s with 200ms polling keeps the test fast under load and
    // tolerant of a busy box.
    let mut latest: i64 = baseline;
    for _ in 0..15 {
        sleep(Duration::from_millis(200)).await;
        latest =
            sqlx::query_scalar("SELECT count(*) FROM discount_snapshots WHERE asset = 'jitoSOL'")
                .fetch_one(&pg)
                .await
                .expect("count latest");
        if latest > baseline {
            break;
        }
    }
    assert!(
        latest > baseline,
        "expected at least one new discount_snapshots row for jitoSOL after Sanctum publish (baseline={baseline}, latest={latest}). \
         Engine may be down or the market side ({{Jupiter}}) didn't have a cached value to compute against."
    );
}

/// Schema contract: the latest `discount_snapshots` row for jitoSOL
/// has every column the engine writes, and the values are within
/// sane bounds (intrinsic positive, market positive, state is one of
/// the enum labels). Pins what downstream consumers can rely on.
#[tokio::test]
async fn discount_snapshot_schema_contract_holds() {
    let Some((pg, _)) = fixtures().await else {
        return;
    };

    let row = sqlx::query(
        "SELECT asset, discount_raw, discount_smooth, state::text AS state,
                confidence, intrinsic_usd, market_usd, ts
         FROM discount_snapshots WHERE asset = 'jitoSOL'
         ORDER BY ts DESC LIMIT 1",
    )
    .fetch_optional(&pg)
    .await
    .expect("query latest");
    let Some(row) = row else {
        panic!("no discount_snapshots for jitoSOL — engine has never written. Is the stack up?");
    };

    let asset: String = row.get("asset");
    let state: String = row.get("state");
    let confidence: String = row.get("confidence");
    let intrinsic: Decimal = row.get("intrinsic_usd");
    let market: Decimal = row.get("market_usd");

    assert_eq!(asset, "jitoSOL");
    assert!(
        matches!(
            state.as_str(),
            "PEGGED" | "DRIFT" | "DEPEG" | "CRITICAL" | "BLACK_SWAN" | "UNKNOWN"
        ),
        "unexpected state label: {state}"
    );
    assert!(
        matches!(confidence.as_str(), "high" | "medium" | "low" | "unknown"),
        "unexpected confidence label: {confidence}"
    );
    assert!(intrinsic > Decimal::ZERO, "intrinsic_usd must be > 0");
    assert!(market > Decimal::ZERO, "market_usd must be > 0");
    let two = Decimal::from(2);
    assert!(
        intrinsic < market * two && market < intrinsic * two,
        "intrinsic and market should be within 2x of each other for a healthy LST (intrinsic={intrinsic}, market={market})"
    );
}

/// Schema contract on the alerts table — every column the dispatcher
/// reads must be populated. Skips when no alerts exist yet (calm
/// universe is a valid state).
#[tokio::test]
async fn alert_schema_contract_holds_when_any_exist() {
    let Some((pg, _)) = fixtures().await else {
        return;
    };

    let row = sqlx::query(
        "SELECT id, asset, class::text AS class,
                from_state::text AS from_state, to_state::text AS to_state,
                discount, intrinsic_usd, market_usd, confidence,
                detected_at
         FROM alerts ORDER BY detected_at DESC LIMIT 1",
    )
    .fetch_optional(&pg)
    .await
    .expect("query latest alert");
    let Some(row) = row else {
        eprintln!("[skip] no alerts to validate — universe has been calm");
        return;
    };

    let id: uuid::Uuid = row.get("id");
    let asset: String = row.get("asset");
    let class: String = row.get("class");
    let from_state: String = row.get("from_state");
    let to_state: String = row.get("to_state");
    let intrinsic: Decimal = row.get("intrinsic_usd");
    let market: Decimal = row.get("market_usd");

    assert!(!asset.is_empty(), "asset must be set");
    assert_ne!(from_state, to_state, "alert is a transition; from != to");
    assert!(intrinsic > Decimal::ZERO);
    assert!(market > Decimal::ZERO);
    // class is one of the documented values
    assert!(
        matches!(
            class.as_str(),
            "lst"
                | "stable_fiat"
                | "stable_cdp"
                | "stable_rwa"
                | "stable_dn"
                | "stable_fx"
                | "synth_lev"
                | "stable_yield"
        ),
        "unexpected asset class: {class}"
    );

    // Stop unused-warning on the rest.
    let _ = (id, Decimal::from_str("0").unwrap());
}
