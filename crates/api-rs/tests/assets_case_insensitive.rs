//! P5: case-insensitive symbol resolution — the catalog-uniqueness guard (so
//! migration 0045's UNIQUE INDEX on lower(symbol) never fails at deploy) and the
//! soft-deleted-preservation behavior (the resolver MUST omit is_active).
//!
//! Gated on `PEGANA_INTEGRATION_API_BASE` + `PEGANA_INTEGRATION_PG_URL`.

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

/// Migration 0045 creates `UNIQUE INDEX ... (lower(symbol))`. If the catalog
/// ever holds two case-insensitively-equal symbols, that migration FAILS at
/// deploy. Catch it here (against the full active + inactive catalog) instead.
#[tokio::test]
async fn catalog_symbols_are_case_unique() {
    let Some(pg) = pg_url() else {
        eprintln!("skip: PEGANA_INTEGRATION_PG_URL not set");
        return;
    };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    let dupes: Vec<(String, i64)> = sqlx::query_as(
        "SELECT lower(symbol), count(*) FROM assets GROUP BY lower(symbol) HAVING count(*) > 1",
    )
    .fetch_all(&pool)
    .await
    .expect("query dupes");
    assert!(
        dupes.is_empty(),
        "case-insensitive symbol collisions would break migration 0045: {dupes:?}"
    );
}

/// A soft-deleted (is_active = false) asset with preserved snapshots must STILL
/// be served by /state — including via a mis-cased path — proving the resolver
/// omits is_active. This is the critical revision the adversarial review caught:
/// adding is_active to the resolver would 404 dSOL/pbUSDC-style assets.
#[tokio::test]
async fn case_insensitive_preserves_soft_deleted_assets() {
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

    const SYM: &str = "ZzCaseTest"; // mixed case; lower() = "zzcasetest"
    cleanup(&pool, SYM).await;

    // INACTIVE asset WITH a snapshot.
    sqlx::query(
        r#"INSERT INTO assets
             (symbol, mint, name, class, peg_target, decimals, intrinsic_kind, thresholds, is_active)
           VALUES ($1, $2, 'Case Test Asset', 'lst'::asset_class, 'SOL'::peg_target, 9,
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

    // Exact case → 200 (soft-deleted assets are still served by /state).
    let resp = client
        .get(format!("{base}/v1/assets/{SYM}/state"))
        .send()
        .await
        .expect("exact-case state");
    assert_eq!(
        resp.status(),
        200,
        "soft-deleted asset must still be served by /state"
    );

    // Mis-cased → 200, canonical casing echoed (resolver omitted is_active).
    let resp = client
        .get(format!("{base}/v1/assets/zzcasetest/state"))
        .send()
        .await
        .expect("mis-cased state");
    assert_eq!(
        resp.status(),
        200,
        "mis-cased soft-deleted asset must resolve (resolver must omit is_active)"
    );
    let st: Value = resp.json().await.expect("state json");
    assert_eq!(
        st.get("asset").and_then(|x| x.as_str()),
        Some(SYM),
        "must echo canonical casing"
    );

    cleanup(&pool, SYM).await;
}
