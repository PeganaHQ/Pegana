//! Integration coverage for the new per-attempt headers introduced in
//! Sprint 1a (`x-pegana-event-id`, `x-pegana-delivery-id`,
//! `x-pegana-attempt`). Spins up a tiny in-test axum sink on a random
//! loopback port, calls `dispatch_one` against it, and asserts the
//! headers the sink received.
//!
//! Loopback dispatch is normally blocked by the SSRF guard; the test
//! sets `WEBHOOK_SSRF_ALLOW_LOOPBACK=1` for itself.

use axum::{body::Bytes, extract::State, http::HeaderMap, routing::post, Router};
use dispatcher_rs::webhook::{dispatch_one, event_id_for, DispatchConfig, SigningKey};
use pegana_common::webhook_sign::{verify_payload_any, verify_payload_v2_any, SigningKeys};
use reqwest::Client as ReqwestClient;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Default)]
struct Captured {
    headers: Vec<HeaderMap>,
    /// Exact request body bytes, parallel to `headers`.
    bodies: Vec<Bytes>,
}

type SharedSink = Arc<Mutex<Captured>>;

async fn sink(State(state): State<SharedSink>, headers: HeaderMap, body: Bytes) -> &'static str {
    let mut c = state.lock().await;
    c.headers.push(headers);
    c.bodies.push(body);
    drop(c);
    "ok"
}

async fn boot_sink() -> (String, SharedSink) {
    let captured: SharedSink = Arc::new(Mutex::new(Captured::default()));
    let app = Router::new()
        .route("/", post(sink))
        .with_state(captured.clone());
    // :0 = ask kernel for a free port.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    // Give axum a tick to start accepting.
    tokio::time::sleep(Duration::from_millis(50)).await;
    (format!("http://{addr}/"), captured)
}

fn cfg() -> DispatchConfig {
    DispatchConfig {
        signing_keys: Some(SigningKeys {
            primary: SigningKey::generate(&mut rand::thread_rng()),
            secondary: None,
        }),
        http: ReqwestClient::new(),
        max_attempts: 1,
        audit_base_url: "https://pegana.test".to_string(),
        retry_backoffs_secs: vec![5, 30, 300, 1800, 7200],
    }
}

#[tokio::test]
async fn dispatch_sends_event_delivery_and_attempt_headers() {
    // Bypass the SSRF guard for loopback delivery.
    std::env::set_var("WEBHOOK_SSRF_ALLOW_LOOPBACK", "1");
    std::env::set_var("PEGANA_ENV", "test");

    let (url, captured) = boot_sink().await;
    let alert_id = Uuid::new_v4();
    let payload = json!({
        "asset": "jitoSOL",
        "from_state": "PEGGED",
        "to_state": "DRIFT",
        "alert_id": alert_id.to_string(),
    });

    let config = cfg();
    let trusted = [config
        .signing_keys
        .as_ref()
        .unwrap()
        .primary
        .verifying_key()];
    let status = dispatch_one(
        &config,
        None,
        Uuid::new_v4(),
        &url,
        alert_id,
        alert_id,
        &payload,
        true,
    )
    .await;
    assert_eq!(status, Ok(200));

    let received = captured.lock().await;
    assert_eq!(received.headers.len(), 1, "expected exactly one delivery");
    let h = &received.headers[0];

    // Stable across retries — must equal alert_id.
    let event_id = h
        .get("x-pegana-event-id")
        .and_then(|v| v.to_str().ok())
        .expect("x-pegana-event-id missing");
    assert_eq!(event_id, alert_id.to_string());

    // Fresh per attempt — must be a parseable UUID.
    let delivery_id = h
        .get("x-pegana-delivery-id")
        .and_then(|v| v.to_str().ok())
        .expect("x-pegana-delivery-id missing");
    Uuid::parse_str(delivery_id).expect("delivery-id must be a uuid");

    // Attempt counter — must be <n>/<max>.
    let attempt = h
        .get("x-pegana-attempt")
        .and_then(|v| v.to_str().ok())
        .expect("x-pegana-attempt missing");
    assert_eq!(attempt, "1/1");

    // Existing headers must still be present.
    assert!(h.contains_key("x-pegana-signature"));
    assert!(h.contains_key("x-pegana-signature-v2"));
    assert!(h.contains_key("x-pegana-timestamp"));
    let ts = h["x-pegana-timestamp"].to_str().unwrap();
    // Verify against the exact bytes the sink received, not a re-serialisation.
    let body = std::str::from_utf8(&received.bodies[0]).unwrap();
    let v1 = h["x-pegana-signature"]
        .to_str()
        .unwrap()
        .strip_prefix("ed25519:")
        .unwrap();
    let v2 = h["x-pegana-signature-v2"]
        .to_str()
        .unwrap()
        .strip_prefix("ed25519:")
        .unwrap();
    assert!(verify_payload_any(&trusted, ts, body, v1));
    assert!(verify_payload_v2_any(&trusted, ts, event_id, body, v2));
    assert!(!verify_payload_v2_any(
        &trusted,
        ts,
        &Uuid::new_v4().to_string(),
        body,
        v2
    ));
    // v2 is domain-separated: the bare `<ts>.<id>.<body>` form must not verify.
    assert!(!verify_payload_v2_any(
        &trusted,
        ts,
        event_id,
        &format!("{body}x"),
        v2
    ));
}

#[tokio::test]
async fn dispatch_retries_keep_event_id_stable_rotate_delivery_id() {
    std::env::set_var("WEBHOOK_SSRF_ALLOW_LOOPBACK", "1");
    std::env::set_var("PEGANA_ENV", "test");

    // Sink that 500s the first two attempts so dispatch_one retries.
    // Need a sink with internal counter to fail then succeed.
    let captured: SharedSink = Arc::new(Mutex::new(Captured::default()));
    let counter = Arc::new(Mutex::new(0u32));

    async fn flaky(
        State((state, counter)): State<(SharedSink, Arc<Mutex<u32>>)>,
        headers: HeaderMap,
        body: Bytes,
    ) -> (axum::http::StatusCode, &'static str) {
        {
            let mut c = state.lock().await;
            c.headers.push(headers);
            c.bodies.push(body);
        }
        let mut n = counter.lock().await;
        *n += 1;
        if *n < 3 {
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "transient")
        } else {
            (axum::http::StatusCode::OK, "ok")
        }
    }

    let app = Router::new()
        .route("/", post(flaky))
        .with_state((captured.clone(), counter.clone()));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    let url = format!("http://{addr}/");

    // 3 attempts; the first two 5xx so dispatch_one retries, the third 200s.
    // cfg_3 below injects a 1s×2 backoff curve (vs production 5s+30s), keeping
    // the whole test ~2s so it runs in CI unconditionally.
    let alert_id = Uuid::new_v4();
    let payload = json!({"alert_id": alert_id.to_string()});

    let cfg_3 = DispatchConfig {
        signing_keys: Some(SigningKeys {
            primary: SigningKey::generate(&mut rand::thread_rng()),
            secondary: None,
        }),
        http: ReqwestClient::new(),
        max_attempts: 3,
        audit_base_url: "https://pegana.test".to_string(),
        // 1s backoffs so the 3 attempts fall in THREE distinct Unix seconds
        // (adding 1.0 always increments floor(t)) — the test can then assert the
        // per-attempt TIMESTAMP + SIGNATURE rotation (the #R2-6 fix). ~2s total, so
        // it runs unconditionally in CI (production uses RETRY_BACKOFFS_SEC =
        // 5s/30s/…, the ~36s that got this gated behind PEGANA_RUN_SLOW_TESTS).
        retry_backoffs_secs: vec![1, 1],
    };

    // Runs unconditionally now: cfg_3's 1s backoffs keep the 3-attempt retry path
    // to ~2s (was ~36s of real sleeps → gated behind PEGANA_RUN_SLOW_TESTS and
    // effectively never exercised in CI).
    let status = dispatch_one(
        &cfg_3,
        None,
        Uuid::new_v4(),
        &url,
        alert_id,
        alert_id,
        &payload,
        true,
    )
    .await;
    assert_eq!(status, Ok(200));

    let received = captured.lock().await;
    assert_eq!(received.headers.len(), 3, "expected 3 attempts");

    // event-id stable across all attempts.
    let ids: Vec<String> = received
        .headers
        .iter()
        .map(|h| {
            h.get("x-pegana-event-id")
                .unwrap()
                .to_str()
                .unwrap()
                .to_string()
        })
        .collect();
    assert_eq!(ids[0], alert_id.to_string());
    assert!(ids.iter().all(|s| s == &ids[0]));

    // delivery-id different per attempt.
    let dids: Vec<String> = received
        .headers
        .iter()
        .map(|h| {
            h.get("x-pegana-delivery-id")
                .unwrap()
                .to_str()
                .unwrap()
                .to_string()
        })
        .collect();
    assert_ne!(dids[0], dids[1]);
    assert_ne!(dids[1], dids[2]);

    // attempt counter increments.
    let attempts: Vec<String> = received
        .headers
        .iter()
        .map(|h| {
            h.get("x-pegana-attempt")
                .unwrap()
                .to_str()
                .unwrap()
                .to_string()
        })
        .collect();
    assert_eq!(attempts, vec!["1/3", "2/3", "3/3"]);

    // #R2-6: timestamp + signature are re-derived PER ATTEMPT, not frozen at
    // attempt 1. Receivers enforce a 300s replay window, so a stale ts would make
    // every retry past ~5min DOA. With 1s backoffs the 3 attempts land in 3
    // distinct Unix seconds → 3 distinct timestamps → (since sig = f(ts, body)) 3
    // distinct signatures. Header value keeps its `ed25519:` prefix.
    let hval = |name: &str| -> Vec<String> {
        received
            .headers
            .iter()
            .map(|h| h.get(name).unwrap().to_str().unwrap().to_string())
            .collect()
    };
    let tss = hval("x-pegana-timestamp");
    assert_ne!(tss[0], tss[1], "timestamp must rotate per attempt (#R2-6)");
    assert_ne!(tss[1], tss[2], "timestamp must rotate per attempt (#R2-6)");
    let sigs = hval("x-pegana-signature");
    let sigs_v2 = hval("x-pegana-signature-v2");
    assert_ne!(sigs_v2[0], sigs_v2[1], "v2 signature must rotate (#R2-6)");
    assert_ne!(sigs_v2[1], sigs_v2[2], "v2 signature must rotate (#R2-6)");
    // Every attempt verifies (v1 and v2) against the exact bytes received,
    // under that attempt's own timestamp.
    let trusted = [cfg_3.signing_keys.as_ref().unwrap().primary.verifying_key()];
    for i in 0..3 {
        let body = std::str::from_utf8(&received.bodies[i]).unwrap();
        let strip = |v: &str| v.strip_prefix("ed25519:").unwrap().to_string();
        assert!(verify_payload_any(
            &trusted,
            &tss[i],
            body,
            &strip(&sigs[i])
        ));
        assert!(verify_payload_v2_any(
            &trusted,
            &tss[i],
            &ids[i],
            body,
            &strip(&sigs_v2[i])
        ));
    }
    assert_ne!(
        sigs[0], sigs[1],
        "signature must rotate with the timestamp (#R2-6)"
    );
    assert_ne!(
        sigs[1], sigs[2],
        "signature must rotate with the timestamp (#R2-6)"
    );
}

#[test]
fn follow_up_event_ids_are_unique_and_deterministic() {
    let alert_id = Uuid::new_v4();
    let retraction = event_id_for(alert_id, "retraction:1.2.3");
    let evidence = event_id_for(alert_id, "evidence:1");
    assert_ne!(retraction, alert_id);
    assert_ne!(evidence, alert_id);
    assert_ne!(retraction, evidence);
    assert_eq!(retraction, event_id_for(alert_id, "retraction:1.2.3"));
}

#[tokio::test]
async fn transport_errors_do_not_leak_the_webhook_url() {
    std::env::set_var("WEBHOOK_SSRF_ALLOW_LOOPBACK", "1");
    std::env::set_var("PEGANA_ENV", "test");
    let alert_id = Uuid::new_v4();
    // Nothing listens on port 1: the send fails with a transport error.
    let err = dispatch_one(
        &cfg(),
        None,
        Uuid::new_v4(),
        "http://127.0.0.1:1/api/webhooks/123/secret-token-abc",
        alert_id,
        alert_id,
        &json!({"alert_id": alert_id.to_string()}),
        true,
    )
    .await
    .expect_err("connection must fail");
    let err = err.to_string();
    assert!(!err.contains("secret-token-abc"), "leaked url in: {err}");
}
