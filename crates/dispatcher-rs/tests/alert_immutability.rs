//! Migration 0082: alerts rows are append-only apart from a single
//! `dispatched_at` stamp. Gated on PEGANA_INTEGRATION_PG_URL.

use uuid::Uuid;

fn pg_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_PG_URL")
        .ok()
        .filter(|s| !s.is_empty())
}

#[tokio::test]
async fn alert_rows_reject_edits_deletes_and_second_dispatch_stamp() {
    let Some(url) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&url).await.expect("connect pg");

    let trigger: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'alerts_immutable')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    if !trigger {
        eprintln!("[skip] alerts_immutable trigger not present (migration 0082 not applied)");
        return;
    }

    let id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO alerts (id, asset, class, from_state, to_state, discount,
                               intrinsic_usd, market_usd, confidence, detected_at, payload)
           VALUES ($1, 'USDC', 'stable_fiat'::asset_class, 'PEGGED'::peg_state, 'DRIFT'::peg_state,
                   0.001, 1.00, 0.999, 'high', NOW(), '{}'::jsonb)"#,
    )
    .bind(id)
    .execute(&pool)
    .await
    .expect("seed alert");

    let to_state_edit =
        sqlx::query("UPDATE alerts SET to_state = 'DEPEG'::peg_state WHERE id = $1")
            .bind(id)
            .execute(&pool)
            .await;
    assert!(to_state_edit.is_err(), "to_state edits must be rejected");

    let first = sqlx::query("UPDATE alerts SET dispatched_at = NOW() WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await;
    assert!(
        first.is_ok(),
        "the first dispatched_at stamp must be allowed"
    );

    let second = sqlx::query("UPDATE alerts SET dispatched_at = NOW() WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await;
    assert!(
        second.is_err(),
        "a second dispatched_at stamp must be rejected"
    );

    let delete = sqlx::query("DELETE FROM alerts WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await;
    assert!(delete.is_err(), "deletes must be rejected");
}
