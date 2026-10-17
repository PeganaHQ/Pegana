//! Pegana webhook receiver — Rust / axum reference.
//!
//! Verifies an Ed25519 signature on `<x-pegana-timestamp>.<body>`
//! using `ed25519-dalek`. Same security envelope as the TypeScript
//! / Cloudflare Worker sample, just running on tokio.
//!
//! Headers you can rely on (Sprint 1a+):
//!   x-pegana-signature      ed25519:<base64 sig>
//!   x-pegana-timestamp      unix seconds (signed input is `<ts>.<body>`)
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
    let mut q = SEEN.lock().unwrap();
    if q.iter().any(|s| s == event_id) {
        return true;
    }
    if q.len() == DEDUP_CAPACITY {
        q.pop_front();
    }
    q.push_back(event_id.to_string());
    false
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().init();
    let app = Router::new().route("/", post(handle));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:9000").await.unwrap();
    tracing::info!("pegana-receiver listening on :9000");
    axum::serve(listener, app).await.unwrap();
}

async fn handle(headers: HeaderMap, body: Bytes) -> Result<&'static str, StatusCode> {
    let sig = headers
        .get("x-pegana-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let ts = headers
        .get("x-pegana-timestamp")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let ts_i: i64 = ts.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    if (now - ts_i).abs() > REPLAY_WINDOW_SEC {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let sig_b64 = sig.strip_prefix("ed25519:").unwrap_or(sig);
    let sig_bytes = STANDARD
        .decode(sig_b64)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    if sig_bytes.len() != 64 {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);
    let sig = Signature::from_bytes(&sig_arr);

    let body_str = std::str::from_utf8(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    let input = format!("{}.{}", ts, body_str);

    // Dual-key trust: try every active pubkey in order. Either valid
    // signature passes — supports zero-downtime key rotation.
    let mut ok = false;
    for pk_b64 in pub_keys_b64() {
        let Ok(pub_bytes) = STANDARD.decode(&pk_b64) else { continue };
        if pub_bytes.len() != 32 {
            continue;
        }
        let mut pub_arr = [0u8; 32];
        pub_arr.copy_from_slice(&pub_bytes);
        let Ok(public) = VerifyingKey::from_bytes(&pub_arr) else { continue };
        if public.verify_strict(input.as_bytes(), &sig).is_ok() {
            ok = true;
            break;
        }
    }
    if !ok {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Cross-attempt dedup via x-pegana-event-id (stable across retries).
    // 200 on duplicate tells Pegana to stop retrying.
    let event_id = headers
        .get("x-pegana-event-id")
        .and_then(|v| v.to_str().ok());
    let attempt = headers
        .get("x-pegana-attempt")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("?");
    if let Some(id) = event_id {
        if seen_before(id) {
            tracing::info!(event_id = %id, attempt = %attempt, "dedup hit");
            return Ok("duplicate ignored");
        }
    }

    let event: serde_json::Value =
        serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    tracing::info!(event_id = ?event_id, attempt = %attempt, ?event, "verified webhook");

    // Your business logic here.
    Ok("ok")
}
