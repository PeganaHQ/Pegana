//! P4 discrimination: `GET /v1/assets/{symbol}/state` distinguishes
//! `unknown_asset` (symbol not in the registry at all) from `no_data` (the
//! symbol IS registered but has no discount snapshot yet) — the old shared
//! "no snapshots for X" plain-text message conflated them.
//!
//! Gated on `PEGANA_INTEGRATION_API_BASE` + `PEGANA_INTEGRATION_PG_URL`:
//!
//! ```bash
//! PEGANA_INTEGRATION_API_BASE=http://localhost:8081 \
//! PEGANA_INTEGRATION_PG_URL=postgres://pegana:pegana@localhost:5434/pegana \
//! cargo test -p api-rs --test state_error_discrimination -- --nocapture
//! ```
//!
//! The registered-but-empty asset is seeded `is_active = false` on purpose: it
//! pins the critical revision that state()'s existence probe MUST omit
//! `is_active` (state has no is_active gate — it serves preserved snapshots for
//! soft-deleted assets), so a soft-deleted asset must read as `no_data`, never
//! `unknown_asset`.

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

#[tokio::test]
async fn state_splits_unknown_asset_from_no_data() {
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

    const SYM: &str = "ZZ_NODATA_TEST";
    cleanup(&pool, SYM).await; // clear any aborted-run leftover

    // 1. Truly unknown symbol → 404 {error: "unknown_asset"} (JSON envelope).
    let resp = client
        .get(format!("{base}/v1/assets/ZZ_DEFINITELY_UNKNOWN_9001/state"))
        .send()
        .await
        .expect("GET unknown state");
    assert_eq!(resp.status(), 404, "unknown symbol must 404");
    let body: Value = resp.json().await.expect("unknown JSON envelope");
    assert_eq!(
        body.get("error").and_then(|x| x.as_str()),
        Some("unknown_asset"),
        "unknown symbol → unknown_asset: {body}"
    );

    // 2. Registered (but INACTIVE, no snapshot) asset → 404 {error: "no_data"}.
    //    Inactive on purpose: proves the existence probe omits is_active.
    sqlx::query(
        r#"INSERT INTO assets
             (symbol, mint, name, class, peg_target, decimals, intrinsic_kind, thresholds, is_active)
           VALUES ($1, $2, 'No-Data Test Asset', 'lst'::asset_class, 'SOL'::peg_target, 9,
                   'pyth_redemption_rate', '{}'::jsonb, false)"#,
    )
    .bind(SYM)
    .bind(format!("MINT_{SYM}"))
    .execute(&pool)
    .await
    .expect("insert registered asset");

    let resp = client
        .get(format!("{base}/v1/assets/{SYM}/state"))
        .send()
        .await
        .expect("GET no_data state");
    assert_eq!(resp.status(), 404, "registered-but-empty must still 404");
    let body: Value = resp.json().await.expect("no_data JSON envelope");
    assert_eq!(
        body.get("error").and_then(|x| x.as_str()),
        Some("no_data"),
        "registered-but-empty (even inactive) asset must be no_data, not unknown_asset: {body}"
    );
    assert_eq!(body.get("asset").and_then(|x| x.as_str()), Some(SYM));

    cleanup(&pool, SYM).await;
}
