//! T-13: a failing subscriber must not delay healthy ones, and the breaker must
//! open from failed attempts inside one retry chain.
//!
//! Real loopback sockets are used with sub-second wall-clock waits rather than
//! `start_paused`: a paused clock auto-advances while a request is in flight
//! and would fire the HTTP timeout spuriously.

use axum::{extract::State, http::StatusCode, routing::post, Router};
use dispatcher_rs::delivery::{DeliveryError, DeliveryPool};
use dispatcher_rs::webhook::{dispatch_with, DispatchConfig};
use reqwest::Client;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use uuid::Uuid;

async fn boot(status: StatusCode) -> (String, Arc<AtomicUsize>) {
    let hits = Arc::new(AtomicUsize::new(0));
    async fn handler(State((hits, status)): State<(Arc<AtomicUsize>, StatusCode)>) -> StatusCode {
        hits.fetch_add(1, Ordering::SeqCst);
        status
    }
    let app = Router::new()
        .route("/", post(handler))
        .with_state((hits.clone(), status));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{addr}/"), hits)
}

fn cfg(backoffs: Vec<u64>) -> Arc<DispatchConfig> {
    Arc::new(DispatchConfig {
        signing_keys: None,
        http: Client::new(),
        max_attempts: 6,
        audit_base_url: "https://pegana.test".into(),
        retry_backoffs_secs: backoffs,
    })
}

/// Start `n` failing chains for a subscriber (they sleep between attempts).
fn start_failing(
    pool: &Arc<DeliveryPool>,
    cfg: &Arc<DispatchConfig>,
    sub: Uuid,
    url: &str,
    n: usize,
) {
    for _ in 0..n {
        let (pool, cfg, url) = (pool.clone(), cfg.clone(), url.to_string());
        pool.clone()
            .try_spawn(async move {
                let id = Uuid::new_v4();
                let _ =
                    dispatch_with(&pool, &cfg, None, sub, &url, id, id, &json!({}), false).await;
            })
            .unwrap();
    }
}

async fn wait_for_hits(hits: &AtomicUsize, at_least: usize) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while hits.load(Ordering::SeqCst) < at_least {
        assert!(
            Instant::now() < deadline,
            "failing subscriber never got hit"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

async fn healthy_delivery_within(pool: &Arc<DeliveryPool>, cfg: &Arc<DispatchConfig>) {
    let (url_b, hits_b) = boot(StatusCode::OK).await;
    let (pool, cfg) = (pool.clone(), cfg.clone());
    let started = Instant::now();
    let b = tokio::spawn(async move {
        let id = Uuid::new_v4();
        dispatch_with(
            &pool,
            &cfg,
            None,
            Uuid::new_v4(),
            &url_b,
            id,
            id,
            &json!({}),
            false,
        )
        .await
    });
    let result = tokio::time::timeout(Duration::from_secs(1), b)
        .await
        .expect("healthy subscriber must not wait behind failing ones")
        .unwrap();
    assert_eq!(result, Ok(200));
    assert_eq!(hits_b.load(Ordering::SeqCst), 1);
    assert!(started.elapsed() < Duration::from_secs(1));
}

/// One permit in total: with the old design (permit held across backoff
/// sleeps) the failing chain would pin it and the healthy delivery would wait
/// out the whole sleep.
#[tokio::test]
async fn one_permit_failing_subscriber_does_not_delay_a_healthy_one() {
    std::env::set_var("WEBHOOK_SSRF_ALLOW_LOOPBACK", "1");
    std::env::set_var("PEGANA_ENV", "test");
    let (url_a, hits_a) = boot(StatusCode::INTERNAL_SERVER_ERROR).await;
    let pool = DeliveryPool::new(1, 100);
    let cfg = cfg(vec![3, 3, 3, 3, 3]);
    start_failing(&pool, &cfg, Uuid::new_v4(), &url_a, 3);
    // A's first attempt has completed and its chain is now sleeping.
    wait_for_hits(&hits_a, 1).await;
    healthy_delivery_within(&pool, &cfg).await;
}

/// Two failing subscribers against two permits.
#[tokio::test]
async fn two_failing_subscribers_two_permits_do_not_delay_a_healthy_one() {
    std::env::set_var("WEBHOOK_SSRF_ALLOW_LOOPBACK", "1");
    std::env::set_var("PEGANA_ENV", "test");
    let (url_a, hits_a) = boot(StatusCode::INTERNAL_SERVER_ERROR).await;
    let (url_c, hits_c) = boot(StatusCode::INTERNAL_SERVER_ERROR).await;
    let pool = DeliveryPool::new(2, 100);
    let cfg = cfg(vec![3, 3, 3, 3, 3]);
    start_failing(&pool, &cfg, Uuid::new_v4(), &url_a, 2);
    start_failing(&pool, &cfg, Uuid::new_v4(), &url_c, 2);
    wait_for_hits(&hits_a, 1).await;
    wait_for_hits(&hits_c, 1).await;
    healthy_delivery_within(&pool, &cfg).await;
}

#[tokio::test]
async fn breaker_opens_from_failed_attempts_inside_one_chain() {
    std::env::set_var("WEBHOOK_SSRF_ALLOW_LOOPBACK", "1");
    std::env::set_var("PEGANA_ENV", "test");
    let (url, hits) = boot(StatusCode::INTERNAL_SERVER_ERROR).await;
    let pool = DeliveryPool::new(4, 100);
    let cfg = cfg(vec![0, 0, 0, 0, 0]);
    let sub = Uuid::new_v4();
    let id = Uuid::new_v4();

    let err = dispatch_with(&pool, &cfg, None, sub, &url, id, id, &json!({}), false)
        .await
        .unwrap_err();
    // Six attempts were allowed, but the chain stops when the fifth failure
    // opens the breaker, and reports the attempts actually made.
    assert!(
        matches!(err, DeliveryError::BreakerOpen { attempts: 5, .. }),
        "{err:?}"
    );
    assert_eq!(err.attempts(), 5);
    assert_eq!(hits.load(Ordering::SeqCst), 5);

    // While open, further deliveries are deferred without touching the network.
    let err = dispatch_with(&pool, &cfg, None, sub, &url, id, id, &json!({}), false)
        .await
        .unwrap_err();
    assert!(
        matches!(err, DeliveryError::BreakerOpen { attempts: 0, .. }),
        "{err:?}"
    );
    assert_eq!(hits.load(Ordering::SeqCst), 5);
}

/// The failure that opens the breaker is reported as a deferral even when it is
/// the last permitted attempt, so that delivery is replayed later.
#[tokio::test]
async fn opening_on_the_last_attempt_is_still_a_deferral() {
    std::env::set_var("WEBHOOK_SSRF_ALLOW_LOOPBACK", "1");
    std::env::set_var("PEGANA_ENV", "test");
    let (url, hits) = boot(StatusCode::INTERNAL_SERVER_ERROR).await;
    let pool = DeliveryPool::new(4, 100);
    let mut c = (*cfg(vec![0, 0, 0, 0])).clone();
    c.max_attempts = 5; // the fifth failure both exhausts the chain and opens the breaker
    let sub = Uuid::new_v4();
    let id = Uuid::new_v4();
    let err = dispatch_with(&pool, &c, None, sub, &url, id, id, &json!({}), false)
        .await
        .unwrap_err();
    assert!(err.is_deferral(), "{err:?}");
    assert_eq!(err.attempts(), 5);
    assert_eq!(hits.load(Ordering::SeqCst), 5);
}
