//! WebSocket handler — subscribe to live asset updates pushed via Redis pub/sub.
//!
//! Each connection opens its own Redis pub/sub subscriber (cheap at single-VPS
//! scale). v1.5: shared subscriber + fan-out if connection count grows.
//!
//! Wire format:
//!   * Engine publishes `{kind:"update", asset, state, discount, intrinsic_usd, ...}`
//!     on `pegana:discount`. We forward to the client as
//!     `{op:"update", asset, payload:{state, discount, ...}}` so the frontend
//!     can merge by asset without re-parsing the envelope.
//!   * Engine publishes `{kind:"heartbeat", ts}` every few seconds; we forward
//!     as `{op:"heartbeat", ts}` so clients can show engine liveness without
//!     relying solely on TCP-level health.

use crate::{AppState, WS_MAX_PER_IP};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, State,
    },
    http::{HeaderMap, StatusCode},
};
use futures::StreamExt;
use pegana_common::channels;
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{debug, info, warn};

const WS_IDLE_TIMEOUT: Duration = Duration::from_secs(120);
const WS_IDLE_GRACE: Duration = Duration::from_secs(30);

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
#[allow(dead_code)] // v1 broadcasts all updates; assets field reserved for v1.5 filtering
enum ClientMsg {
    Subscribe { assets: Vec<String> },
    Unsubscribe { assets: Vec<String> },
    Ping,
}

#[derive(Debug, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum ServerMsg {
    Pong,
    Error {
        msg: String,
    },
    Update {
        asset: String,
        payload: serde_json::Value,
    },
    Heartbeat {
        ts: serde_json::Value,
    },
}

/// `GET /v1/ws` — upgrade to a WebSocket carrying the live peg-state stream.
///
/// Not a JSON endpoint: a successful handshake returns `101 Switching
/// Protocols`. After upgrade the server pushes `{op:"update", ...}` and
/// `{op:"heartbeat", ts}` frames; the client may send `{op:"ping"}` (→ `pong`)
/// and `{op:"subscribe"|"unsubscribe", assets:[...]}`. Browsers must present an
/// allowlisted `Origin`; server-to-server tools may omit it.
#[utoipa::path(
    get,
    path = "/v1/ws",
    tag = "WebSocket",
    responses(
        (status = 101, description = "Switching Protocols — WebSocket established"),
        (status = 403, description = "Origin present but not on the allowlist"),
        (status = 429, description = "Per-IP connection cap reached"),
    )
)]
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<axum::response::Response, (StatusCode, &'static str)> {
    // Reject upgrades whose Origin header isn't on the allowlist.
    // Browsers always send Origin on cross-origin WS handshakes; the only
    // callers that legitimately omit it are server-to-server tools (curl,
    // wscat) which we don't want to lock out of debugging, so a missing
    // header is allowed. A *present but unrecognised* origin is the case
    // we want to reject — that's a browser tab on a hostile site.
    if let Some(origin) = headers
        .get(axum::http::header::ORIGIN)
        .and_then(|v| v.to_str().ok())
    {
        let allowed = state.allowed_origins.iter().any(|a| a == origin);
        if !allowed {
            metrics::counter!("pegana_ws_rejected_total", "reason" => "origin").increment(1);
            return Err((StatusCode::FORBIDDEN, "origin not allowed"));
        }
    }

    // Honor X-Forwarded-For so we count by real client IP behind Caddy.
    let ip = client_ip(&headers, addr);

    // Reserve a connection slot. Rejection is cheap (no upgrade performed).
    if !try_reserve(&state.ws_per_ip, ip, WS_MAX_PER_IP) {
        metrics::counter!("pegana_ws_rejected_total", "reason" => "per_ip_cap").increment(1);
        return Err((StatusCode::TOO_MANY_REQUESTS, "too many ws connections"));
    }

    // Hold the slot guard across the upgrade so the reservation is freed on BOTH
    // paths: when `handle` returns (success) AND when this closure is dropped
    // without ever running (a failed/aborted upgrade — which previously leaked
    // the slot). Ownership moves into the closure alongside `state`/`ip`.
    let slot = WsSlotGuard {
        state: state.clone(),
        ip,
    };
    Ok(ws.on_upgrade(move |socket| handle(socket, state, ip, slot)))
}

fn client_ip(headers: &HeaderMap, conn: SocketAddr) -> IpAddr {
    if let Some(raw) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = raw.split(',').next() {
            if let Ok(ip) = first.trim().parse::<IpAddr>() {
                return ip;
            }
        }
    }
    conn.ip()
}

type PerIpMap = std::sync::Mutex<std::collections::HashMap<IpAddr, u32>>;

fn try_reserve(map: &PerIpMap, ip: IpAddr, cap: u32) -> bool {
    let mut m = map.lock().expect("ws_per_ip poisoned");
    let entry = m.entry(ip).or_insert(0);
    if *entry >= cap {
        return false;
    }
    *entry += 1;
    true
}

fn release(map: &PerIpMap, ip: IpAddr) {
    let mut m = map.lock().expect("ws_per_ip poisoned");
    if let Some(n) = m.get_mut(&ip) {
        *n = n.saturating_sub(1);
        if *n == 0 {
            m.remove(&ip);
        }
    }
}

fn idle_expired(last_seen: Instant, now: Instant, timeout: Duration) -> bool {
    now.saturating_duration_since(last_seen) >= timeout
}

async fn handle(
    mut socket: WebSocket,
    state: Arc<AppState>,
    client: IpAddr,
    // The per-IP slot reservation, moved in from `ws_handler`. Held for the whole
    // connection; freed when this fn returns (any exit path) via its Drop. Kept
    // as a param — not reconstructed here — so a failed upgrade that never calls
    // `handle` still releases it (see WsSlotGuard).
    _slot: WsSlotGuard,
) {
    info!(?client, "ws client connected");
    metrics::gauge!("pegana_ws_clients_active").increment(1.0);
    // Decrement the active-clients gauge on any exit path (early return, break,
    // drop). The slot release is handled by `_slot` above.
    let _gauge_guard = WsGaugeGuard;

    // Open a dedicated pub/sub subscriber for this client.
    let mut pubsub = match state.redis.get_async_pubsub().await {
        Ok(p) => p,
        Err(e) => {
            warn!(?e, "ws redis pubsub open failed");
            let _ = socket
                .send(Message::Text(
                    serde_json::to_string(&ServerMsg::Error {
                        msg: "live channel unavailable".into(),
                    })
                    .unwrap_or_default(),
                ))
                .await;
            return;
        }
    };
    if let Err(e) = pubsub.subscribe(channels::DISCOUNT).await {
        warn!(?e, "ws redis subscribe failed");
        return;
    }
    let mut redis_stream = pubsub.on_message();
    let mut last_seen = Instant::now();
    let mut idle_ping_sent_at: Option<Instant> = None;

    loop {
        let idle_deadline = match idle_ping_sent_at {
            Some(sent_at) => sent_at + WS_IDLE_GRACE,
            None => last_seen + WS_IDLE_TIMEOUT,
        };

        tokio::select! {
            _ = tokio::time::sleep_until(tokio::time::Instant::from_std(idle_deadline)) => {
                let now = Instant::now();
                if let Some(sent_at) = idle_ping_sent_at {
                    if idle_expired(sent_at, now, WS_IDLE_GRACE)
                        && idle_expired(last_seen, now, WS_IDLE_TIMEOUT)
                    {
                        debug!(?client, "ws idle timeout elapsed after ping grace");
                        let _ = socket.send(Message::Close(None)).await;
                        break;
                    }
                } else if idle_expired(last_seen, now, WS_IDLE_TIMEOUT) {
                    // Server-side read deadline: an idle client gets one protocol
                    // ping and must reply with any frame before the grace window ends.
                    if socket.send(Message::Ping(Vec::new())).await.is_err() {
                        break;
                    }
                    idle_ping_sent_at = Some(now);
                }
            }
            client_msg = socket.recv() => {
                let Some(msg) = client_msg else { break; };
                let msg = match msg {
                    Ok(m) => m,
                    Err(e) => {
                        warn!(?e, "ws recv error");
                        break;
                    }
                };
                last_seen = Instant::now();
                idle_ping_sent_at = None;
                match msg {
                    Message::Text(text) => {
                        let response = match serde_json::from_str::<ClientMsg>(&text) {
                            Ok(ClientMsg::Ping) => ServerMsg::Pong,
                            Ok(ClientMsg::Subscribe { assets }) => {
                                debug!(?assets, "ws subscribe (v1 = no-op, broadcasts to all)");
                                ServerMsg::Update {
                                    asset: "system".into(),
                                    payload: serde_json::json!({
                                        "msg": "subscribed",
                                        "assets": assets,
                                        "note": "v1 broadcasts all updates; client-side filter recommended"
                                    }),
                                }
                            }
                            Ok(ClientMsg::Unsubscribe { .. }) => ServerMsg::Pong,
                            Err(e) => ServerMsg::Error { msg: format!("malformed: {e}") },
                        };
                        if let Ok(json) = serde_json::to_string(&response) {
                            if socket.send(Message::Text(json)).await.is_err() {
                                break;
                            }
                        }
                    }
                    Message::Close(_) => break,
                    Message::Ping(p) => {
                        let _ = socket.send(Message::Pong(p)).await;
                    }
                    _ => {}
                }
            }
            redis_msg = redis_stream.next() => {
                let Some(redis_msg) = redis_msg else {
                    debug!("ws redis stream ended");
                    break;
                };
                let payload: String = match redis_msg.get_payload() {
                    Ok(s) => s,
                    Err(e) => {
                        warn!(?e, "ws bad redis payload");
                        continue;
                    }
                };
                let value: serde_json::Value = match serde_json::from_str(&payload) {
                    Ok(v) => v,
                    Err(e) => {
                        debug!(?e, "ws skip non-json pubsub frame");
                        continue;
                    }
                };
                let (frame, op_label) = match value.get("kind").and_then(|v| v.as_str()) {
                    Some("update") => {
                        let asset = value
                            .get("asset")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if asset.is_empty() {
                            continue;
                        }
                        let mut payload_obj = value.clone();
                        if let Some(obj) = payload_obj.as_object_mut() {
                            obj.remove("kind");
                            obj.remove("asset");
                        }
                        (ServerMsg::Update { asset, payload: payload_obj }, "update")
                    }
                    Some("heartbeat") => (
                        ServerMsg::Heartbeat {
                            ts: value.get("ts").cloned().unwrap_or(serde_json::Value::Null),
                        },
                        "heartbeat",
                    ),
                    _ => continue,
                };
                if let Ok(json) = serde_json::to_string(&frame) {
                    if socket.send(Message::Text(json)).await.is_err() {
                        break;
                    }
                    metrics::counter!("pegana_ws_forwarded_total", "op" => op_label).increment(1);
                }
            }
        }
    }

    info!("ws client disconnected");
}

/// Decrements the active-clients gauge on every exit path of `handle` (early
/// return, break, drop). Gauge-only — the per-IP slot is freed separately by
/// [`WsSlotGuard`] so that a FAILED upgrade (where `handle` never runs, so the
/// gauge was never incremented) doesn't drive the gauge negative.
struct WsGaugeGuard;
impl Drop for WsGaugeGuard {
    fn drop(&mut self) {
        metrics::gauge!("pegana_ws_clients_active").decrement(1.0);
    }
}

/// Frees the per-IP connection slot on drop. Constructed in `ws_handler` right
/// after `try_reserve` and MOVED into the `on_upgrade` closure, so the slot is
/// released whether the upgrade SUCCEEDS (dropped when `handle` returns) OR
/// FAILS — in which case the closure, and this guard with it, is dropped without
/// ever running `handle`. Previously the release lived only inside `handle`, so a
/// failed/aborted upgrade after `try_reserve` leaked the slot permanently until
/// the process restarted (a per-IP DoS foothold).
struct WsSlotGuard {
    state: Arc<AppState>,
    ip: IpAddr,
}
impl Drop for WsSlotGuard {
    fn drop(&mut self) {
        release(&self.state.ws_per_ip, self.ip);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::net::Ipv4Addr;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    #[test]
    fn idle_expired_only_after_configured_window() {
        let last_seen = Instant::now();
        let timeout = Duration::from_secs(120);

        assert!(!idle_expired(
            last_seen,
            last_seen + Duration::from_secs(119),
            timeout
        ));
        assert!(idle_expired(last_seen, last_seen + timeout, timeout));
    }

    #[test]
    fn idle_expired_uses_most_recent_inbound_activity() {
        let first_seen = Instant::now();
        let refreshed = first_seen + Duration::from_secs(100);
        let timeout = Duration::from_secs(120);

        assert!(!idle_expired(
            refreshed,
            first_seen + Duration::from_secs(150),
            timeout
        ));
    }

    #[test]
    fn reserve_then_release_balances() {
        let map: PerIpMap = Mutex::new(HashMap::new());
        let ip = IpAddr::V4(Ipv4Addr::LOCALHOST);
        for _ in 0..WS_MAX_PER_IP {
            assert!(try_reserve(&map, ip, WS_MAX_PER_IP));
        }
        assert!(
            !try_reserve(&map, ip, WS_MAX_PER_IP),
            "should reject above cap"
        );
        release(&map, ip);
        assert!(
            try_reserve(&map, ip, WS_MAX_PER_IP),
            "slot frees after release"
        );
    }

    #[test]
    fn different_ips_have_independent_caps() {
        let map: PerIpMap = Mutex::new(HashMap::new());
        let a = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));
        let b = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 2));
        for _ in 0..WS_MAX_PER_IP {
            assert!(try_reserve(&map, a, WS_MAX_PER_IP));
        }
        assert!(try_reserve(&map, b, WS_MAX_PER_IP), "b has its own bucket");
    }

    #[test]
    fn release_on_unknown_ip_is_noop() {
        let map: PerIpMap = Mutex::new(HashMap::new());
        release(&map, IpAddr::V4(Ipv4Addr::LOCALHOST)); // must not panic
        assert!(map.lock().unwrap().is_empty());
    }
}
