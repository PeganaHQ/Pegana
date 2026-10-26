//! Integration test — boots a reference receiver and exercises the
//! signed-payload matrix (accept-valid, reject-stale, reject-bad-sig).
//!
//! Gated on `PEGANA_RUN_RECEIVER_TESTS=1` because the receiver
//! subprocess + ports are environment-specific. The harness
//! script at `scripts/test-webhook-receivers.sh` knows how to
//! launch each reference receiver with the right env / public-key
//! injection; this Rust test just hits whatever URL was set.
//!
//! Required env when running:
//!   PEGANA_WEBHOOK_SIGNING_KEY  base64 32-byte secret (same key
//!                                you injected into the receiver)
//!   RECEIVER_URL                http(s) URL the receiver listens on
//!
//! Optional:
//!   PEGANA_RECEIVER_NAME        used only for assert messages

use base64::{engine::general_purpose::STANDARD, Engine};
use dispatcher_rs::webhook::{sign_payload, SigningKey};
use reqwest::Client;
use std::time::{SystemTime, UNIX_EPOCH};

fn skip() -> bool {
    std::env::var("PEGANA_RUN_RECEIVER_TESTS").ok().as_deref() != Some("1")
}

fn ts_now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        .to_string()
}

fn load_key() -> SigningKey {
    let raw = std::env::var("PEGANA_WEBHOOK_SIGNING_KEY")
        .expect("PEGANA_WEBHOOK_SIGNING_KEY must be set when receiver tests run");
    let bytes = STANDARD
        .decode(&raw)
        .expect("PEGANA_WEBHOOK_SIGNING_KEY must be base64");
    assert_eq!(bytes.len(), 32, "signing key must be 32 bytes");
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    SigningKey::from_bytes(&arr)
}

fn url() -> String {
    std::env::var("RECEIVER_URL").unwrap_or_else(|_| "http://127.0.0.1:9000".to_string())
}

#[tokio::test]
async fn accept_valid_signed_payload() {
    if skip() {
        return;
    }
    let key = load_key();
    let body = r#"{"asset":"jitoSOL","from_state":"PEGGED","to_state":"DRIFT","discount_bps":47,"ts":"2026-05-26T22:00:00Z","alert_id":"550e8400-e29b-41d4-a716-446655440000"}"#;
    let ts = ts_now();
    let sig = sign_payload(&key, &ts, body);
    let res = Client::new()
        .post(url())
        .header("x-pegana-signature", format!("ed25519:{sig}"))
        .header("x-pegana-timestamp", &ts)
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .expect("receiver unreachable");
    assert!(
        res.status().is_success(),
        "expected 2xx from valid payload, got {} ({})",
        res.status(),
        res.text().await.unwrap_or_default()
    );
}

#[tokio::test]
async fn reject_stale_timestamp() {
    if skip() {
        return;
    }
    let key = load_key();
    let body = r#"{"asset":"jitoSOL","alert_id":"550e8400-e29b-41d4-a716-446655440000"}"#;
    let ts = "1700000000"; // well outside the 5-minute window
    let sig = sign_payload(&key, ts, body);
    let res = Client::new()
        .post(url())
        .header("x-pegana-signature", format!("ed25519:{sig}"))
        .header("x-pegana-timestamp", ts)
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .expect("receiver unreachable");
    assert_eq!(
        res.status().as_u16(),
        401,
        "stale timestamp must be rejected with 401",
    );
}

#[tokio::test]
async fn reject_bad_signature() {
    if skip() {
        return;
    }
    let body = r#"{"asset":"jitoSOL"}"#;
    let ts = ts_now();
    let res = Client::new()
        .post(url())
        .header("x-pegana-signature", "ed25519:AAAA")
        .header("x-pegana-timestamp", &ts)
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .expect("receiver unreachable");
    assert_eq!(
        res.status().as_u16(),
        401,
        "bad signature must be rejected with 401",
    );
}

#[tokio::test]
async fn idempotent_retry_same_alert_id() {
    if skip() {
        return;
    }
    let key = load_key();
    let body = r#"{"asset":"jitoSOL","alert_id":"550e8400-e29b-41d4-a716-446655440000"}"#;
    let ts = ts_now();
    let sig = sign_payload(&key, &ts, body);
    let client = Client::new();
    let send = || async {
        client
            .post(url())
            .header("x-pegana-signature", format!("ed25519:{sig}"))
            .header("x-pegana-timestamp", &ts)
            .header("content-type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .expect("receiver unreachable")
    };
    let r1 = send().await;
    let r2 = send().await;
    // Receivers SHOULD dedupe on alert_id; minimum behaviour is both
    // responses succeed (idempotent). We don't assert response-body
    // equality because the receiver may legitimately respond
    // "duplicate ignored" on the second call.
    assert!(r1.status().is_success(), "first delivery should succeed");
    assert!(
        r2.status().is_success(),
        "retry should also succeed (idempotent)"
    );
}
