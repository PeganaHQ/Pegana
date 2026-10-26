//! ADR-0003 retraction protocol end-to-end test (SQL shape only).
//!
//! Gated on PEGANA_INTEGRATION_PG_URL. Skips silently in CI.
//!
//! Verifies the SQL query that finds affected subscribers — the POST
//! fan-out itself uses `dispatch_one` which has its own coverage in
//! `webhook_dispatch_headers.rs` + `webhook_receivers.rs`.
//!
//! Run locally (against prod-local stack on :5434):
//!
//!   PEGANA_INTEGRATION_PG_URL=postgres://pegana:pegana@localhost:5434/pegana \
//!     cargo test -p dispatcher-rs --test retraction_worker -- --nocapture

use sqlx::PgPool;
use uuid::Uuid;

fn pg_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_PG_URL")
        .ok()
        .filter(|s| !s.is_empty())
}

/// HAND-MAINTAINED copy of the worker's SQL (NOT imported from it). ⚠️ It does
/// NOT auto-catch drift: editing the real query in `fan_out_retraction` will not
/// fail this test unless this copy is manually kept in sync — so treat it as a
/// shape/behavior fixture, not a drift guard. To make it genuinely drift-proof,
/// extract the query into a shared `pub(crate)` helper both call (tracked
/// follow-up). Returns (sub_id, alert_id) pairs that should receive a retraction.
async fn affected_subs(pool: &PgPool, broken_version: &str) -> Vec<(Uuid, Uuid)> {
    let rows: Vec<(Uuid, Uuid, String, String)> = sqlx::query_as(
        "SELECT DISTINCT wd.subscription_id, wd.alert_id, ws.url, ws.channel_type \
         FROM webhook_deliveries wd \
         JOIN alert_evidence ae ON ae.alert_id = wd.alert_id \
         JOIN webhook_subscriptions ws ON ws.id = wd.subscription_id \
         WHERE ae.methodology_version = $1 \
           AND wd.http_status BETWEEN 200 AND 299 \
           AND ws.is_active = TRUE",
    )
    .bind(broken_version)
    .fetch_all(pool)
    .await
    .expect("query");
    rows.into_iter().map(|(s, a, _, _)| (s, a)).collect()
}

/// Best-effort cleanup. Test creates rows under unique uuids/versions so
/// in practice there's nothing to clobber, but a torn previous run could
/// leave webhook_deliveries / alert_evidence orphans if alerts got purged
/// — leave those alone (the trigger forbids DELETE on alert_evidence).
async fn cleanup_methodology(pool: &PgPool, version: &str) {
    let _ = sqlx::query("DELETE FROM retractions WHERE methodology_version = $1")
        .bind(version)
        .execute(pool)
        .await;
}

/// Probe whether the webhook tables exist in the target DB. The
/// prod-local docker stack on :5434 carries a partial snapshot (no
/// webhook_subscriptions / webhook_deliveries) for some developer
/// workflows; this lets the test skip cleanly there instead of
/// burying a "relation does not exist" error in CI noise.
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

#[tokio::test]
async fn affected_subs_only_includes_2xx_deliveries_of_broken_version() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");

    if !webhook_tables_present(&pool).await {
        eprintln!(
            "[skip] affected_subs_only_includes_2xx_deliveries_of_broken_version — \
             webhook_subscriptions/webhook_deliveries not present in target DB"
        );
        return;
    }

    // Empty-input sanity check: a never-seen broken version must return
    // an empty result, proving the SQL itself parses + executes.
    let none = affected_subs(&pool, "0.0.0-never-existed").await;
    assert!(none.is_empty(), "unknown version must return no subs");

    // Unique tag to avoid clashing with parallel test runs or seeded data.
    let tag = format!("retract-test-{}", &Uuid::new_v4().to_string()[..8]);
    let broken_version = format!("9.broken.{tag}");
    let good_version = format!("9.good.{tag}");
    let asset = "USDC";

    cleanup_methodology(&pool, &broken_version).await;
    cleanup_methodology(&pool, &good_version).await;

    // Seed methodology versions (we mark `broken_version` as 'active' here;
    // the worker only cares about the JOIN, not the status — operators
    // flip status to 'broken' as part of the retraction runbook).
    for v in [&broken_version, &good_version] {
        sqlx::query(
            "INSERT INTO methodology_versions (version, git_tag, released_at, status, notes) \
             VALUES ($1, $2, NOW(), 'active', 'retraction worker test') \
             ON CONFLICT (version) DO NOTHING",
        )
        .bind(v)
        .bind(format!("tag-{v}"))
        .execute(&pool)
        .await
        .expect("seed methodology_versions");
    }

    // Two alerts: one produced by broken_version, one by good_version.
    let alert_broken = Uuid::new_v4();
    let alert_good = Uuid::new_v4();
    for (id, version) in [
        (alert_broken, broken_version.as_str()),
        (alert_good, good_version.as_str()),
    ] {
        sqlx::query(
            r#"INSERT INTO alerts (id, asset, class, from_state, to_state, discount,
                                   intrinsic_usd, market_usd, confidence, detected_at, payload)
               VALUES ($1, $2, 'stable_fiat'::asset_class, 'PEGGED'::peg_state, 'DRIFT'::peg_state,
                       0.001, 1.00, 0.999, 'high', NOW(), '{}'::jsonb)"#,
        )
        .bind(id)
        .bind(asset)
        .execute(&pool)
        .await
        .expect("seed alert");
        sqlx::query(
            r#"INSERT INTO alert_evidence
                   (alert_id, methodology_version, assets_toml_sha256,
                    inputs_frozen, computed, receipt_sha256)
               VALUES ($1, $2, repeat('a', 64),
                       '{"asset":"USDC"}'::jsonb, '{"final_state":"DRIFT"}'::jsonb,
                       repeat('b', 64))"#,
        )
        .bind(id)
        .bind(version)
        .execute(&pool)
        .await
        .expect("seed evidence");
    }

    // Need a user row to satisfy webhook_subscriptions.user_id FK.
    // `users.id` is BIGSERIAL — INSERT then read it back. Only the
    // base columns from 0001_initial; alerts_enabled defaults TRUE
    // when migration 0027 is present.
    let user_id: i64 =
        sqlx::query_scalar("INSERT INTO users (chat_id, locale) VALUES ($1, 'en-US') RETURNING id")
            .bind(rand_chat_id())
            .fetch_one(&pool)
            .await
            .expect("seed user");

    // Two subscriptions to the same asset. sub_x will get a 2xx
    // delivery of alert_broken (the candidate); sub_y will get a 500
    // delivery of alert_broken (NOT a candidate — failed delivery).
    let sub_x: Uuid = sqlx::query_scalar(
        "INSERT INTO webhook_subscriptions (user_id, url, asset, threshold_bps, is_active) \
         VALUES ($1, $2, $3, 10, TRUE) RETURNING id",
    )
    .bind(user_id)
    .bind(format!("https://example.invalid/{tag}-x"))
    .bind(asset)
    .fetch_one(&pool)
    .await
    .expect("seed sub_x");

    let sub_y: Uuid = sqlx::query_scalar(
        "INSERT INTO webhook_subscriptions (user_id, url, asset, threshold_bps, is_active) \
         VALUES ($1, $2, $3, 10, TRUE) RETURNING id",
    )
    .bind(user_id)
    .bind(format!("https://example.invalid/{tag}-y"))
    .bind(asset)
    .fetch_one(&pool)
    .await
    .expect("seed sub_y");

    // sub_x receives alert_broken successfully (200).
    sqlx::query(
        "INSERT INTO webhook_deliveries \
            (subscription_id, alert_id, attempt, http_status, elapsed_ms, error) \
         VALUES ($1, $2, 1, 200, 42, NULL)",
    )
    .bind(sub_x)
    .bind(alert_broken)
    .execute(&pool)
    .await
    .expect("seed delivery sub_x/alert_broken/200");

    // sub_x also received alert_good successfully — should NOT be flagged
    // (good_version isn't retracted).
    sqlx::query(
        "INSERT INTO webhook_deliveries \
            (subscription_id, alert_id, attempt, http_status, elapsed_ms, error) \
         VALUES ($1, $2, 1, 200, 42, NULL)",
    )
    .bind(sub_x)
    .bind(alert_good)
    .execute(&pool)
    .await
    .expect("seed delivery sub_x/alert_good/200");

    // sub_y received alert_broken but with a 500 — should NOT be flagged
    // (no successful delivery means no signal to retract).
    sqlx::query(
        "INSERT INTO webhook_deliveries \
            (subscription_id, alert_id, attempt, http_status, elapsed_ms, error) \
         VALUES ($1, $2, 1, 500, 42, 'http 500: boom')",
    )
    .bind(sub_y)
    .bind(alert_broken)
    .execute(&pool)
    .await
    .expect("seed delivery sub_y/alert_broken/500");

    // DISTINCT check: sub_x gets a second 200 attempt of alert_broken
    // (e.g. operator-triggered replay). Result must still de-dupe to
    // one (sub_x, alert_broken) row, not two.
    sqlx::query(
        "INSERT INTO webhook_deliveries \
            (subscription_id, alert_id, attempt, http_status, elapsed_ms, error) \
         VALUES ($1, $2, 2, 200, 42, NULL)",
    )
    .bind(sub_x)
    .bind(alert_broken)
    .execute(&pool)
    .await
    .expect("seed delivery sub_x/alert_broken/200 retry");

    let result = affected_subs(&pool, &broken_version).await;

    // Expectation:
    //   exactly ONE pair: (sub_x, alert_broken)
    //   sub_y excluded (no 2xx)
    //   alert_good excluded (good version)
    //   duplicate attempt collapsed by DISTINCT
    assert_eq!(
        result.len(),
        1,
        "expected exactly one (sub, alert) pair, got: {result:?}"
    );
    assert_eq!(
        result[0],
        (sub_x, alert_broken),
        "wrong pair flagged for retraction"
    );

    // Toggle sub_x inactive and re-run — must drop out (no point firing
    // a retraction at a deactivated sub).
    sqlx::query("UPDATE webhook_subscriptions SET is_active = FALSE WHERE id = $1")
        .bind(sub_x)
        .execute(&pool)
        .await
        .expect("deactivate sub_x");
    let after = affected_subs(&pool, &broken_version).await;
    assert!(
        after.is_empty(),
        "inactive subs must not receive retractions, got: {after:?}"
    );
}

/// Migration 0039 (audit B P2): the retractions table is split into
/// audit-immutable columns (methodology_version, retracted_at, reason,
/// fix_url) and operationally-mutable counters (onchain_tx_sig,
/// webhook_refire_count, bot_refire_count). UPDATEs on the audit columns
/// must raise; UPDATEs on the counters must pass.
#[tokio::test]
async fn retractions_partial_immutability_trigger_blocks_audit_updates() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");

    // Skip cleanly when the retractions table is missing (partial dev DBs).
    let retractions_present: bool = sqlx::query_as::<_, (bool,)>(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables \
         WHERE table_name = 'retractions')",
    )
    .fetch_one(&pool)
    .await
    .map(|(b,)| b)
    .unwrap_or(false);
    if !retractions_present {
        eprintln!(
            "[skip] retractions_partial_immutability_trigger_blocks_audit_updates — \
             retractions table not present"
        );
        return;
    }

    // Skip if migration 0039 hasn't been applied yet (the trigger is what
    // we're testing; without it the audit-update would succeed and the
    // assertions would mislead operators reading CI failure logs).
    let trigger_present: bool = sqlx::query_as::<_, (bool,)>(
        "SELECT EXISTS (SELECT 1 FROM pg_trigger \
         WHERE tgname = 'retractions_no_audit_mutation')",
    )
    .fetch_one(&pool)
    .await
    .map(|(b,)| b)
    .unwrap_or(false);
    if !trigger_present {
        eprintln!(
            "[skip] retractions_partial_immutability_trigger_blocks_audit_updates — \
             migration 0039 not applied (trigger absent)"
        );
        return;
    }

    let tag = format!("retract-immut-{}", &Uuid::new_v4().to_string()[..8]);
    let version = format!("9.immut.{tag}");

    cleanup_methodology(&pool, &version).await;

    // Seed the methodology version row first (PK FK on retractions).
    sqlx::query(
        "INSERT INTO methodology_versions (version, git_tag, released_at, status, notes) \
         VALUES ($1, $2, NOW(), 'active', 'partial-immutability test') \
         ON CONFLICT (version) DO NOTHING",
    )
    .bind(&version)
    .bind(format!("tag-{version}"))
    .execute(&pool)
    .await
    .expect("seed methodology_versions");

    sqlx::query(
        "INSERT INTO retractions \
            (methodology_version, reason, fix_url, webhook_refire_count, bot_refire_count) \
         VALUES ($1, 'ewma_alpha_off_by_one', \
                 'https://github.com/lrafasouza/pegana/pull/123', 0, 0)",
    )
    .bind(&version)
    .execute(&pool)
    .await
    .expect("seed retraction row");

    // Audit-immutable column — UPDATE must FAIL.
    let blocked =
        sqlx::query("UPDATE retractions SET reason = 'rewritten' WHERE methodology_version = $1")
            .bind(&version)
            .execute(&pool)
            .await;
    assert!(
        blocked.is_err(),
        "UPDATE on retractions.reason must be blocked by the trigger; got {:?}",
        blocked
    );
    let err_msg = format!("{}", blocked.unwrap_err());
    assert!(
        err_msg.contains("immutable"),
        "trigger error must mention immutability; got: {err_msg}"
    );

    // Operationally-mutable counter — UPDATE must SUCCEED. The dispatcher
    // increments this as it fans out webhook re-fires.
    let allowed = sqlx::query(
        "UPDATE retractions SET webhook_refire_count = webhook_refire_count + 1 \
         WHERE methodology_version = $1",
    )
    .bind(&version)
    .execute(&pool)
    .await
    .expect("counter UPDATE must be allowed by the trigger");
    assert_eq!(allowed.rows_affected(), 1);

    // And similarly onchain_tx_sig — NULL -> non-NULL transition is the
    // dispatcher's commit-landed signal.
    let sig_update =
        sqlx::query("UPDATE retractions SET onchain_tx_sig = $1 WHERE methodology_version = $2")
            .bind("5".repeat(88))
            .bind(&version)
            .execute(&pool)
            .await
            .expect("onchain_tx_sig UPDATE must be allowed by the trigger");
    assert_eq!(sig_update.rows_affected(), 1);

    // Verify reason was NOT mutated despite the failed UPDATE above.
    let (reason,): (String,) =
        sqlx::query_as("SELECT reason FROM retractions WHERE methodology_version = $1")
            .bind(&version)
            .fetch_one(&pool)
            .await
            .expect("read back reason");
    assert_eq!(
        reason, "ewma_alpha_off_by_one",
        "reason must retain its seeded value — UPDATE attempt should have rolled back"
    );

    cleanup_methodology(&pool, &version).await;
}

/// Cheap random chat_id that won't collide with seeded fixtures. Uses
/// nanoseconds since UNIX epoch ⊕ a fresh uuid byte — overwhelmingly
/// unlikely to repeat across parallel test runs, but cleaned up by the
/// test runner's transactional isolation anyway when present.
fn rand_chat_id() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as i64)
        .unwrap_or(0);
    let salt = i64::from(Uuid::new_v4().as_bytes()[0]);
    // Negative chat_ids in Telegram = groups; keep positive to mimic a
    // real user chat.
    (nanos.abs() ^ salt) | 1
}

/// A retraction nobody received is marked processed (-2), not left pending, so
/// it is not claimed again every poll.
#[tokio::test]
async fn zero_subscriber_retraction_is_marked_processed() {
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");
    if !webhook_tables_present(&pool).await {
        eprintln!("[skip] zero_subscriber_retraction_is_marked_processed — webhook tables absent");
        return;
    }
    // Stale rows from an aborted earlier run would be claimed first (oldest
    // wins), so clear them before seeding.
    let _ = sqlx::query("DELETE FROM retractions WHERE reason = 'zero subscribers'")
        .execute(&pool)
        .await;
    let version = format!("9.zero.{}", &Uuid::new_v4().to_string()[..8]);
    sqlx::query(
        "INSERT INTO methodology_versions (version, git_tag, released_at, status, notes) \
         VALUES ($1, $2, NOW(), 'active', 'zero subscriber test')",
    )
    .bind(&version)
    .bind(format!("tag-{version}"))
    .execute(&pool)
    .await
    .expect("seed version");
    // Oldest possible, so this worker claims it before any other pending row.
    sqlx::query(
        "INSERT INTO retractions (methodology_version, retracted_at, reason) \
         VALUES ($1, 'epoch', 'zero subscribers')",
    )
    .bind(&version)
    .execute(&pool)
    .await
    .expect("seed retraction");

    let cfg = std::sync::Arc::new(dispatcher_rs::webhook::DispatchConfig {
        signing_keys: None,
        http: reqwest::Client::new(),
        max_attempts: 1,
        audit_base_url: "https://pegana.test".into(),
        retry_backoffs_secs: vec![],
    });
    dispatcher_rs::retraction::poll_once(
        &pool,
        cfg,
        dispatcher_rs::delivery::global_pool().clone(),
    )
    .await
    .expect("poll");

    let count: i32 = sqlx::query_scalar(
        "SELECT webhook_refire_count FROM retractions WHERE methodology_version = $1",
    )
    .bind(&version)
    .fetch_one(&pool)
    .await
    .unwrap();
    cleanup_methodology(&pool, &version).await;
    let _ = sqlx::query("DELETE FROM methodology_versions WHERE version = $1")
        .bind(&version)
        .execute(&pool)
        .await;
    assert_eq!(count, -2);
}
