//! Channel-projection integration coverage.
//!
//! - `discord_body_is_accepted_generic_body_is_rejected` is the REGRESSION
//!   LOCK for the original silent-404 bug: a sink that enforces Discord's
//!   "must contain content/embeds" contract rejects the OLD generic body and
//!   accepts the NEW discord projection.
//! - `honors_retry_after_on_429` proves the retry loop sleeps a receiver's
//!   `Retry-After` hint instead of the fixed 5s curve step.
//! - `mixed_channel_fanout_renders_each_correctly` drives 200 concurrent
//!   dispatches (bounded by a 50-permit semaphore, mirroring production) across
//!   all three channels and asserts every body is channel-valid.
//!
//! Loopback dispatch is normally blocked by the SSRF guard; these tests set
//! `WEBHOOK_SSRF_ALLOW_LOOPBACK=1` for themselves.

use axum::{
    extract::State,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use dispatcher_rs::webhook::{dispatch_one, DispatchConfig, SigningKey};
use pegana_common::webhook_channel::{render_for_channel, ChannelType};
use pegana_common::webhook_sign::SigningKeys;
use reqwest::Client as ReqwestClient;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use uuid::Uuid;

fn cfg(max_attempts: u8) -> DispatchConfig {
    DispatchConfig {
        signing_keys: Some(SigningKeys {
            primary: SigningKey::generate(&mut rand::thread_rng()),
            secondary: None,
        }),
        http: ReqwestClient::new(),
        max_attempts,
        audit_base_url: "https://pegana.test".to_string(),
        retry_backoffs_secs: vec![5, 30, 300, 1800, 7200],
    }
}

fn alert_canonical() -> Value {
    json!({
        "asset": "jitoSOL", "from_state": "PEGGED", "to_state": "DRIFT",
        "discount_bps": -47, "ts": "2026-06-09T00:00:00Z",
        "alert_id": "11111111-1111-1111-1111-111111111111",
        "evidence_url": "https://pegana.xyz/audit/x", "evidence_status": "ready"
    })
}

// ── Regression lock ──────────────────────────────────────────────────────

/// Mimics Discord: 400 "Cannot send an empty message" unless content/embeds.
async fn discord_contract(Json(b): Json<Value>) -> StatusCode {
    if b.get("content").is_some() || b.get("embeds").is_some() {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::BAD_REQUEST
    }
}

async fn boot(router: Router) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    format!("http://{addr}/")
}

#[tokio::test]
async fn discord_body_is_accepted_generic_body_is_rejected() {
    std::env::set_var("WEBHOOK_SSRF_ALLOW_LOOPBACK", "1");
    let url = boot(Router::new().route("/", post(discord_contract))).await;
    let http = ReqwestClient::new();

    // OLD behavior: generic canonical → Discord rejects (the original bug).
    let generic = render_for_channel(ChannelType::Generic, &alert_canonical());
    let r = http.post(&url).json(&generic.body).send().await.unwrap();
    assert_eq!(
        r.status(),
        400,
        "generic body must be rejected by a Discord-contract sink"
    );

    // NEW behavior: discord projection → accepted.
    let discord = render_for_channel(ChannelType::Discord, &alert_canonical());
    let r = http.post(&url).json(&discord.body).send().await.unwrap();
    assert_eq!(r.status(), 204, "discord embed body must be accepted");
}

// ── Retry-After ──────────────────────────────────────────────────────────

async fn flaky_429(State(hits): State<Arc<AtomicUsize>>) -> Response {
    let n = hits.fetch_add(1, Ordering::SeqCst);
    if n == 0 {
        (StatusCode::TOO_MANY_REQUESTS, [(header::RETRY_AFTER, "1")]).into_response()
    } else {
        StatusCode::NO_CONTENT.into_response()
    }
}

#[tokio::test]
async fn honors_retry_after_on_429() {
    std::env::set_var("WEBHOOK_SSRF_ALLOW_LOOPBACK", "1");
    let hits = Arc::new(AtomicUsize::new(0));
    let app = Router::new()
        .route("/", post(flaky_429))
        .with_state(hits.clone());
    let url = boot(app).await;

    let started = Instant::now();
    // max_attempts=2: attempt 1 → 429 Retry-After:1, attempt 2 → 204.
    let status = dispatch_one(
        &cfg(2),
        None,
        Uuid::new_v4(),
        &url,
        Uuid::new_v4(),
        &render_for_channel(ChannelType::Discord, &alert_canonical()).body,
        false,
    )
    .await;
    let elapsed = started.elapsed();

    assert_eq!(status, Ok(204), "should succeed on the second attempt");
    assert_eq!(hits.load(Ordering::SeqCst), 2, "exactly two attempts");
    assert!(
        elapsed >= Duration::from_millis(900),
        "must honor the ~1s Retry-After hint, got {elapsed:?}"
    );
    assert!(
        elapsed < Duration::from_secs(4),
        "must NOT fall back to the 5s curve step when Retry-After is present, got {elapsed:?}"
    );
}

// ── Mixed-channel concurrency / stress ───────────────────────────────────

async fn record_body(
    State(store): State<Arc<Mutex<Vec<Value>>>>,
    Json(b): Json<Value>,
) -> StatusCode {
    store.lock().unwrap().push(b);
    StatusCode::NO_CONTENT
}

#[tokio::test]
async fn mixed_channel_fanout_renders_each_correctly() {
    std::env::set_var("WEBHOOK_SSRF_ALLOW_LOOPBACK", "1");
    let store: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
    let app = Router::new()
        .route("/", post(record_body))
        .with_state(store.clone());
    let url = boot(app).await;

    let cfg = Arc::new(cfg(1));
    let sem = Arc::new(Semaphore::new(50)); // same cap as production fan-out
    let mut handles = Vec::new();
    const N: usize = 200;
    for i in 0..N {
        let cfg = cfg.clone();
        let sem = sem.clone();
        let url = url.clone();
        let ch = match i % 3 {
            0 => ChannelType::Generic,
            1 => ChannelType::Discord,
            _ => ChannelType::Slack,
        };
        let permit = sem.acquire_owned().await.unwrap();
        handles.push(tokio::spawn(async move {
            let _permit = permit;
            let rendered = render_for_channel(ch, &alert_canonical());
            dispatch_one(
                &cfg,
                None,
                Uuid::new_v4(),
                &url,
                Uuid::new_v4(),
                &rendered.body,
                rendered.sign,
            )
            .await
        }));
    }

    let mut ok = 0usize;
    for h in handles {
        if let Ok(Ok(204)) = h.await {
            ok += 1;
        }
    }
    assert_eq!(ok, N, "all {N} dispatches must succeed under concurrency");

    let bodies = store.lock().unwrap();
    assert_eq!(bodies.len(), N, "sink must receive all {N} bodies");
    let embeds = bodies.iter().filter(|b| b.get("embeds").is_some()).count();
    let attachments = bodies
        .iter()
        .filter(|b| b.get("attachments").is_some())
        .count();
    let generic = bodies
        .iter()
        .filter(|b| b.get("from_state").is_some())
        .count();
    assert!(
        embeds > 0 && attachments > 0 && generic > 0,
        "all channel shapes present"
    );
    assert_eq!(
        embeds + attachments + generic,
        N,
        "every body is exactly one channel shape"
    );
}
