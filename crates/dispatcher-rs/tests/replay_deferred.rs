//! Deferred deliveries are replayed once, oldest first, under their original
//! event id, and stamped `replayed_at`. Gated on PEGANA_INTEGRATION_PG_URL.

use axum::{body::Bytes, extract::State, http::HeaderMap, routing::post, Router};
use dispatcher_rs::delivery::BREAKER_DEAD_LETTER_PREFIX;
use dispatcher_rs::replay::{has_unreplayed, replay_deferred};
use dispatcher_rs::webhook::{DispatchConfig, SigningKey};
use pegana_common::webhook_sign::{verify_payload_v2_any, SigningKeys};
use reqwest::Client;
use serde_json::json;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use uuid::Uuid;

type Seen = Arc<Mutex<Vec<(HeaderMap, Bytes)>>>;

async fn sink(
    State(seen): State<Seen>,
    headers: HeaderMap,
    body: Bytes,
) -> (axum::http::StatusCode, &'static str) {
    // A payload the receiver rejects for good.
    let poison = std::str::from_utf8(&body).unwrap_or("").contains("poison");
    seen.lock().await.push((headers, body));
    if poison {
        (axum::http::StatusCode::BAD_REQUEST, "no")
    } else {
        (axum::http::StatusCode::OK, "ok")
    }
}

#[tokio::test]
async fn replays_marker_rows_once_with_original_event_id() {
    let Some(url) = std::env::var("PEGANA_INTEGRATION_PG_URL")
        .ok()
        .filter(|s| !s.is_empty())
    else {
        return;
    };
    std::env::set_var("WEBHOOK_SSRF_ALLOW_LOOPBACK", "1");
    std::env::set_var("PEGANA_ENV", "test");
    let pg = sqlx::PgPool::connect(&url).await.expect("connect pg");
    let has_col: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns \
         WHERE table_name = 'webhook_dead_letter' AND column_name = 'replayed_at')",
    )
    .fetch_one(&pg)
    .await
    .unwrap();
    if !has_col {
        eprintln!("[skip] migration 0086 not applied");
        return;
    }

    let seen: Seen = Arc::new(Mutex::new(Vec::new()));
    let app = Router::new()
        .route("/", post(sink))
        .with_state(seen.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let sink_url = format!("http://{}/", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let user_id: i64 =
        sqlx::query_scalar("INSERT INTO users (chat_id, locale) VALUES ($1, 'en-US') RETURNING id")
            .bind(Uuid::new_v4().as_u128() as i64 & 0x7fff_ffff_ffff)
            .fetch_one(&pg)
            .await
            .expect("seed user");
    let sub: Uuid = sqlx::query_scalar(
        "INSERT INTO webhook_subscriptions (user_id, url, asset, threshold_bps, is_active) \
         VALUES ($1, $2, 'USDC', 10, TRUE) RETURNING id",
    )
    .bind(user_id)
    .bind(&sink_url)
    .fetch_one(&pg)
    .await
    .expect("seed sub");

    let alert_id = Uuid::new_v4();
    let event_id = Uuid::new_v4();
    let payload = json!({"type": "retraction", "alert_id": alert_id});
    let marker = format!("{BREAKER_DEAD_LETTER_PREFIX} circuit breaker open (attempts=0): x");
    for (err, ev) in [(marker.as_str(), Some(event_id)), ("http 500: nope", None)] {
        sqlx::query(
            "INSERT INTO webhook_dead_letter \
               (subscription_id, alert_id, payload, last_error, attempts, event_id) \
             VALUES ($1, $2, $3, $4, 0, $5)",
        )
        .bind(sub)
        .bind(alert_id)
        .bind(&payload)
        .bind(err)
        .bind(ev)
        .execute(&pg)
        .await
        .unwrap();
    }
    assert!(has_unreplayed(&pg, sub).await);

    let key = SigningKey::generate(&mut rand::thread_rng());
    let trusted = [key.verifying_key()];
    let cfg = Arc::new(DispatchConfig {
        signing_keys: Some(SigningKeys {
            primary: key,
            secondary: None,
        }),
        http: Client::new(),
        max_attempts: 1,
        audit_base_url: "https://pegana.test".into(),
        retry_backoffs_secs: vec![],
    });

    assert_eq!(replay_deferred(&pg, &cfg, sub).await, 1);
    {
        let got = seen.lock().await;
        assert_eq!(got.len(), 1, "exactly one POST: the marker row");
        let (h, body) = &got[0];
        assert_eq!(
            h["x-pegana-event-id"].to_str().unwrap(),
            event_id.to_string()
        );
        let ts = h["x-pegana-timestamp"].to_str().unwrap();
        let sig = h["x-pegana-signature-v2"]
            .to_str()
            .unwrap()
            .strip_prefix("ed25519:")
            .unwrap();
        assert!(verify_payload_v2_any(
            &trusted,
            ts,
            &event_id.to_string(),
            std::str::from_utf8(body).unwrap(),
            sig
        ));
    }
    let unreplayed: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM webhook_dead_letter WHERE subscription_id = $1 AND replayed_at IS NULL",
    )
    .bind(sub)
    .fetch_one(&pg)
    .await
    .unwrap();
    assert_eq!(unreplayed, 1, "only the non-marker row stays unreplayed");

    // Rerun: nothing left to send.
    assert!(!has_unreplayed(&pg, sub).await);
    assert_eq!(replay_deferred(&pg, &cfg, sub).await, 0);
    assert_eq!(seen.lock().await.len(), 1);
}

/// A payload the receiver rejects permanently must not stall the rows behind
/// it, and is given up on after a few rejections.
#[tokio::test]
async fn poison_row_does_not_stall_replay_and_is_given_up() {
    let Some(url) = std::env::var("PEGANA_INTEGRATION_PG_URL")
        .ok()
        .filter(|s| !s.is_empty())
    else {
        return;
    };
    std::env::set_var("WEBHOOK_SSRF_ALLOW_LOOPBACK", "1");
    std::env::set_var("PEGANA_ENV", "test");
    let pg = sqlx::PgPool::connect(&url).await.expect("connect pg");
    let has_col: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns \
         WHERE table_name = 'webhook_dead_letter' AND column_name = 'replay_failed_at')",
    )
    .fetch_one(&pg)
    .await
    .unwrap();
    if !has_col {
        eprintln!("[skip] migration 0086 not applied");
        return;
    }
    let seen: Seen = Arc::new(Mutex::new(Vec::new()));
    let app = Router::new()
        .route("/", post(sink))
        .with_state(seen.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let sink_url = format!("http://{}/", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let user_id: i64 =
        sqlx::query_scalar("INSERT INTO users (chat_id, locale) VALUES ($1, 'en-US') RETURNING id")
            .bind(Uuid::new_v4().as_u128() as i64 & 0x7fff_ffff_ffff)
            .fetch_one(&pg)
            .await
            .unwrap();
    let sub: Uuid = sqlx::query_scalar(
        "INSERT INTO webhook_subscriptions (user_id, url, asset, threshold_bps, is_active) \
         VALUES ($1, $2, 'USDC', 10, TRUE) RETURNING id",
    )
    .bind(user_id)
    .bind(&sink_url)
    .fetch_one(&pg)
    .await
    .unwrap();
    let marker = format!("{BREAKER_DEAD_LETTER_PREFIX} circuit breaker open (attempts=0): x");
    let (poison_id, good_id) = (Uuid::new_v4(), Uuid::new_v4());
    for (id, body, age_s) in [(poison_id, "poison", 10), (good_id, "fine", 5)] {
        sqlx::query(
            "INSERT INTO webhook_dead_letter \
               (subscription_id, alert_id, payload, last_error, attempts, failed_at) \
             VALUES ($1, $2, $3, $4, 0, now() - make_interval(secs => $5))",
        )
        .bind(sub)
        .bind(id)
        .bind(json!({ "note": body }))
        .bind(&marker)
        .bind(age_s as f64)
        .execute(&pg)
        .await
        .unwrap();
    }
    let key = SigningKey::generate(&mut rand::thread_rng());
    let cfg = Arc::new(DispatchConfig {
        signing_keys: Some(SigningKeys {
            primary: key,
            secondary: None,
        }),
        http: Client::new(),
        max_attempts: 6,
        audit_base_url: "https://pegana.test".into(),
        retry_backoffs_secs: vec![],
    });

    // The poison row (older) is rejected, the good row behind it still goes out.
    assert_eq!(replay_deferred(&pg, &cfg, sub).await, 1);
    let state = |id: Uuid| {
        let pg = pg.clone();
        async move {
            sqlx::query_as::<_, (bool, i16, bool)>(
                "SELECT replayed_at IS NOT NULL, replay_attempts, replay_failed_at IS NOT NULL \
                 FROM webhook_dead_letter WHERE alert_id = $1",
            )
            .bind(id)
            .fetch_one(&pg)
            .await
            .unwrap()
        }
    };
    assert_eq!(state(good_id).await, (true, 0, false));
    assert_eq!(state(poison_id).await, (false, 1, false));
    // Rejected twice more: given up, and never retried again.
    replay_deferred(&pg, &cfg, sub).await;
    replay_deferred(&pg, &cfg, sub).await;
    assert_eq!(state(poison_id).await, (false, 3, true));
    let before = seen.lock().await.len();
    assert_eq!(replay_deferred(&pg, &cfg, sub).await, 0);
    assert_eq!(seen.lock().await.len(), before);
    assert!(!has_unreplayed(&pg, sub).await);
}

async fn pg_or_skip() -> Option<sqlx::PgPool> {
    let url = std::env::var("PEGANA_INTEGRATION_PG_URL")
        .ok()
        .filter(|s| !s.is_empty())?;
    let pg = sqlx::PgPool::connect(&url).await.ok()?;
    let ok: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns \
         WHERE table_name = 'webhook_dead_letter' AND column_name = 'replay_failed_at')",
    )
    .fetch_one(&pg)
    .await
    .unwrap_or(false);
    if !ok {
        eprintln!("[skip] migration 0086 not applied");
        return None;
    }
    Some(pg)
}

async fn seed_sub(pg: &sqlx::PgPool, url: &str) -> Uuid {
    let user_id: i64 =
        sqlx::query_scalar("INSERT INTO users (chat_id, locale) VALUES ($1, 'en-US') RETURNING id")
            .bind(Uuid::new_v4().as_u128() as i64 & 0x7fff_ffff_ffff)
            .fetch_one(pg)
            .await
            .unwrap();
    sqlx::query_scalar(
        "INSERT INTO webhook_subscriptions (user_id, url, asset, threshold_bps, is_active) \
         VALUES ($1, $2, 'USDC', 10, TRUE) RETURNING id",
    )
    .bind(user_id)
    .bind(url)
    .fetch_one(pg)
    .await
    .unwrap()
}

async fn seed_deferred(pg: &sqlx::PgPool, sub: Uuid, note: &str, age_s: f64) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO webhook_dead_letter \
           (subscription_id, alert_id, payload, last_error, attempts, failed_at) \
         VALUES ($1, $2, $3, $4, 0, now() - make_interval(secs => $5))",
    )
    .bind(sub)
    .bind(id)
    .bind(json!({ "note": note }))
    .bind(format!(
        "{BREAKER_DEAD_LETTER_PREFIX} circuit breaker open (attempts=0): x"
    ))
    .bind(age_s)
    .execute(pg)
    .await
    .unwrap();
    id
}

fn replay_cfg() -> Arc<DispatchConfig> {
    Arc::new(DispatchConfig {
        signing_keys: Some(SigningKeys {
            primary: SigningKey::generate(&mut rand::thread_rng()),
            secondary: None,
        }),
        http: Client::new(),
        max_attempts: 6,
        audit_base_url: "https://pegana.test".into(),
        retry_backoffs_secs: vec![],
    })
}

/// Many permanently rejected rows must not open the breaker (which would pause
/// live alerts and trap the probe on the poison rows), and must not stop the
/// good row behind them.
#[tokio::test]
async fn many_poison_rows_do_not_open_the_breaker() {
    let Some(pg) = pg_or_skip().await else { return };
    std::env::set_var("WEBHOOK_SSRF_ALLOW_LOOPBACK", "1");
    std::env::set_var("PEGANA_ENV", "test");
    let seen: Seen = Arc::new(Mutex::new(Vec::new()));
    let app = Router::new()
        .route("/", post(sink))
        .with_state(seen.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let sink_url = format!("http://{}/", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let sub = seed_sub(&pg, &sink_url).await;
    let mut poison = Vec::new();
    for i in 0..6 {
        poison.push(seed_deferred(&pg, sub, "poison", 100.0 - i as f64).await);
    }
    let good = seed_deferred(&pg, sub, "fine", 1.0).await;
    let cfg = replay_cfg();

    assert_eq!(
        replay_deferred(&pg, &cfg, sub).await,
        1,
        "the good row goes out"
    );
    assert!(
        !dispatcher_rs::delivery::global_pool()
            .breaker
            .is_open(sub, std::time::Instant::now()),
        "permanent rejections must not open the breaker"
    );
    let stamped: bool = sqlx::query_scalar(
        "SELECT replayed_at IS NOT NULL FROM webhook_dead_letter WHERE alert_id = $1",
    )
    .bind(good)
    .fetch_one(&pg)
    .await
    .unwrap();
    assert!(stamped);
    replay_deferred(&pg, &cfg, sub).await;
    replay_deferred(&pg, &cfg, sub).await;
    for id in poison {
        let (attempts, failed): (i16, bool) = sqlx::query_as(
            "SELECT replay_attempts, replay_failed_at IS NOT NULL \
             FROM webhook_dead_letter WHERE alert_id = $1",
        )
        .bind(id)
        .fetch_one(&pg)
        .await
        .unwrap();
        assert_eq!((attempts, failed), (3, true), "given up after 3 rejections");
    }
    assert!(!dispatcher_rs::delivery::global_pool()
        .breaker
        .is_open(sub, std::time::Instant::now()));
}

/// `kick` must return immediately when no background slot is free.
#[tokio::test]
async fn kick_does_not_wait_when_the_background_pool_is_saturated() {
    let Some(pg) = pg_or_skip().await else { return };
    let sub = seed_sub(&pg, "https://example.invalid/").await;
    seed_deferred(&pg, sub, "fine", 1.0).await;
    let pool = dispatcher_rs::delivery::DeliveryPool::new(2, 4); // 1 background slot
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    pool.try_spawn_background(async move {
        let _ = rx.await;
    })
    .expect("occupy the only background slot");
    let started = std::time::Instant::now();
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        dispatcher_rs::replay::kick_on(&pool, &pg, &replay_cfg(), sub),
    )
    .await
    .expect("kick must not block on a saturated pool");
    assert!(started.elapsed() < std::time::Duration::from_secs(1));
    assert_eq!(pool.inflight(), 1, "no replay was queued behind the holder");
    let _ = tx.send(());
}
