//! Pegana webhook receiver — Rust / axum reference.
//!
//! Verifies Ed25519 v2 on `pegana-webhook-v2.<ts>.<event_id>.<body>`,
//! with v1 `<ts>.<body>` accepted only when v2 is absent.
//! using `ed25519-dalek`. Same security envelope as the TypeScript
//! / Cloudflare Worker sample, just running on tokio.
//!
//! Headers you can rely on (Sprint 1a+):
//!   x-pegana-signature      ed25519:<base64 sig>
//!   x-pegana-signature-v2   ed25519:<base64 sig> (preferred)
//!   x-pegana-timestamp      unix seconds
//!   x-pegana-event-id       stable across retries — dedup on this
//!   x-pegana-delivery-id    fresh per attempt — log correlation
//!   x-pegana-attempt        "<n>/<max>" — page on n == max-1

use axum::{
    body::Bytes,
    http::{HeaderMap, StatusCode},
    routing::post,
    Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

// Active Pegana Ed25519 public keys.
//
// Authoritative source: GET https://api.pegana.xyz/v1/meta/webhook-keys
//   { "pubkeys_b64": [primary, secondary?] }
//
// During a key rotation window BOTH keys are live — pre-trust the new
// pubkey before the cutover by polling /v1/meta/webhook-keys at least
// daily. Set PEGANA_PUB_KEY_B64 as CSV ("primary,secondary") to load
// both at boot. The verify loop below tries each in order.
const DEFAULT_PEGANA_PUB_KEYS_B64: &str = "gAKAhNG4BLCF0xm/gCcDb0OcP6cxzt1IfXkmkzyVYVo=";
const REPLAY_WINDOW_SEC: i64 = 300;
const DEDUP_CAPACITY: usize = 10_000;

fn valid_event_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                *b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(b)
            }
        })
}

fn signed_message(v2: bool, ts: &str, event_id: &str, body: &str) -> String {
    if v2 {
        format!("pegana-webhook-v2.{ts}.{event_id}.{body}")
    } else {
        format!("{ts}.{body}")
    }
}

fn verify_signature(signature: &str, input: &[u8], pubkeys: &[String]) -> bool {
    let Some(sig_b64) = signature.strip_prefix("ed25519:") else {
        return false;
    };
    let Ok(sig_bytes) = STANDARD.decode(sig_b64) else {
        return false;
    };
    let Ok(sig_arr): Result<[u8; 64], _> = sig_bytes.try_into() else {
        return false;
    };
    let sig = Signature::from_bytes(&sig_arr);
    for pk_b64 in pubkeys {
        let Ok(pub_bytes) = STANDARD.decode(pk_b64) else {
            continue;
        };
        let Ok(pub_arr): Result<[u8; 32], _> = pub_bytes.try_into() else {
            continue;
        };
        let Ok(public) = VerifyingKey::from_bytes(&pub_arr) else {
            continue;
        };
        if public.verify_strict(input, &sig).is_ok() {
            return true;
        }
    }
    false
}

fn pub_keys_b64() -> Vec<String> {
    std::env::var("PEGANA_PUB_KEY_B64")
        .unwrap_or_else(|_| DEFAULT_PEGANA_PUB_KEYS_B64.to_string())
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Bounded FIFO dedup of `x-pegana-event-id`. In production, back this
/// with Redis (`SET event:<id> 1 EX 86400 NX`) or Postgres so the
/// guarantee survives restart + horizontal scale. The example uses an
/// in-process VecDeque purely so the sample runs with zero external
/// dependencies.
static SEEN: std::sync::LazyLock<Mutex<VecDeque<String>>> =
    std::sync::LazyLock::new(|| Mutex::new(VecDeque::with_capacity(DEDUP_CAPACITY)));

fn seen_before(event_id: &str) -> bool {
    SEEN.lock().unwrap().iter().any(|s| s == event_id)
}

fn mark_processed(event_id: &str) {
    let mut q = SEEN.lock().unwrap();
    if q.iter().any(|s| s == event_id) {
        return;
    }
    if q.len() == DEDUP_CAPACITY {
        q.pop_front();
    }
    q.push_back(event_id.to_string());
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().init();
    let app = Router::new().route("/", post(handle));
    let bind =
        std::env::var("PEGANA_RECEIVER_BIND").unwrap_or_else(|_| "127.0.0.1:9000".to_string());
    let listener = tokio::net::TcpListener::bind(&bind).await.unwrap();
    tracing::info!("pegana-receiver listening on {bind}");
    axum::serve(listener, app).await.unwrap();
}

async fn handle(headers: HeaderMap, body: Bytes) -> Result<&'static str, StatusCode> {
    let v2_header = headers.get("x-pegana-signature-v2");
    let sig = v2_header
        .or_else(|| headers.get("x-pegana-signature"))
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let event_id = headers
        .get("x-pegana-event-id")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if !valid_event_id(event_id) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let ts = headers
        .get("x-pegana-timestamp")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let ts_i: i64 = ts.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    if now.abs_diff(ts_i) > REPLAY_WINDOW_SEC as u64 {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let body_str = std::str::from_utf8(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    let input = signed_message(v2_header.is_some(), ts, event_id, body_str);

    // Dual-key trust: try every active pubkey in order. Either valid
    // signature passes — supports zero-downtime key rotation.
    if !verify_signature(sig, input.as_bytes(), &pub_keys_b64()) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let event: serde_json::Value =
        serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    // Cross-attempt dedup via the signed v2 event id. It can differ from
    // body.alert_id for retractions and evidence refires.
    let attempt = headers
        .get("x-pegana-attempt")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("?");
    if seen_before(event_id) {
        tracing::info!(event_id = %event_id, attempt = %attempt, "dedup hit");
        return Ok("duplicate ignored");
    }

    tracing::info!(event_id = %event_id, attempt = %attempt, ?event, "verified webhook");

    // Your business logic here.
    // Mark completion only after business logic succeeds.
    mark_processed(event_id);
    Ok("ok")
}

#[cfg(test)]
mod tests {
    use super::*;

    const TS: &str = "1700000000";
    const EVENT_ID: &str = "00000000-0000-4000-8000-000000000001";
    const BODY: &str = r#"{"alert_id":"00000000-0000-4000-8000-000000000001","asset":"jitoSOL","to_state":"DEPEG"}"#;
    const PUBKEY: &str = "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=";
    const V1: &str =
        "Gpu1U4olo6STeYr27K6qYvWl90VawFLzkF8vUNZzWCIuKmFwtHS3lNNWNbbHmQY3wM6Rupj1M1GFFaqSMpEiDw==";
    const V2: &str =
        "EAiQCh9Cbfqho1Z8TV6s2TyyY9gMslfn756wqO5bVwOJl62yztsBBmMNJiVONK5PfUwkw+36XaYkPd7o+IsNBw==";

    #[test]
    fn golden_signatures_and_event_binding() {
        let keys = vec![PUBKEY.to_string()];
        assert!(valid_event_id(EVENT_ID));
        assert!(!valid_event_id("00000000-0000-4000-8000-00000000000A"));
        assert!(verify_signature(
            &format!("ed25519:{V1}"),
            signed_message(false, TS, EVENT_ID, BODY).as_bytes(),
            &keys
        ));
        assert!(verify_signature(
            &format!("ed25519:{V2}"),
            signed_message(true, TS, EVENT_ID, BODY).as_bytes(),
            &keys
        ));
        assert!(!verify_signature(
            &format!("ed25519:{V2}"),
            signed_message(true, TS, "00000000-0000-4000-8000-000000000002", BODY).as_bytes(),
            &keys
        ));
        assert!(!verify_signature(
            &format!("ed25519:{V1}"),
            signed_message(true, TS, EVENT_ID, BODY).as_bytes(),
            &keys
        ));
        assert!(!verify_signature(
            V2,
            signed_message(true, TS, EVENT_ID, BODY).as_bytes(),
            &keys
        ));
    }
}
