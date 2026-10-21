//! WebSocket handler — live asset updates fanned out from ONE shared Redis
//! pub/sub subscription.
//!
//! Fan-out: a single background task ([`spawn_redis_fanout`]) holds the only
//! Redis subscriber on `pegana:discount`, translates each engine frame into the
//! client wire format ONCE, and pushes the serialized text onto a
//! `tokio::sync::broadcast` channel ([`WsHub`]). Every socket is a broadcast
//! receiver, so a WebSocket costs exactly one file descriptor (its own TCP
//! socket) instead of two (socket plus a dedicated Redis connection). With a
//! per-client subscriber, the api's 1024 soft fd limit capped the whole process
//! (REST included) at roughly 490 concurrent sockets.
//!
//! Wire format:
//!   * Engine publishes `{kind:"update", asset, state, discount, intrinsic_usd, ...}`
//!     on `pegana:discount`. We forward to the client as
//!     `{op:"update", asset, payload:{state, discount, ...}}` so the frontend
//!     can merge by asset without re-parsing the envelope.
//!   * Engine publishes `{kind:"heartbeat", ts}` every few seconds; we forward
//!     as `{op:"heartbeat", ts}` so clients can show engine liveness without
//!     relying solely on TCP-level health.
//!   * Updates for a non-public class (`synth_lev`, e.g. xSOL) are dropped at
//!     the hub, matching `/v1/assets`, the feed and the detail routes.

use crate::error::ApiError;
use crate::{AppState, WS_MAX_PER_IP, WS_MAX_TOTAL};
use axum::{
    extract::{
        ws::{rejection::WebSocketUpgradeRejection, Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, State,
    },
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures::StreamExt;
use pegana_common::channels;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use tracing::{debug, info, warn};

const WS_IDLE_TIMEOUT: Duration = Duration::from_secs(120);
const WS_IDLE_GRACE: Duration = Duration::from_secs(30);

/// Frames buffered per receiver before a slow socket starts missing frames
/// (`RecvError::Lagged`). The engine emits about 3 frames/s, so 1024 is over
/// five minutes of backlog; a socket that far behind skips ahead instead of
/// growing memory without bound.
pub const WS_BROADCAST_CAPACITY: usize = 1024;

/// Seconds a client is asked to wait after a capacity rejection.
const WS_RETRY_AFTER_SECS: u64 = 30;

/// Backoff bounds for re-opening the shared Redis subscription.
const FANOUT_BACKOFF_MIN: Duration = Duration::from_millis(500);
const FANOUT_BACKOFF_MAX: Duration = Duration::from_secs(30);

/// Longest gap between Redis frames before the shared subscription counts as
/// stalled. The engine heartbeats every 5s, so 30s of silence means a
/// half-open or wedged connection, not a quiet market. Without this one stuck
/// subscription would freeze every socket until the api restarts, since
/// client reconnects all attach to the same hub.
const FANOUT_SILENCE: Duration = Duration::from_secs(30);

/// Cadence for re-reading which symbols are not public.
const EXCLUDED_REFRESH: Duration = Duration::from_secs(300);
/// Retry cadence while the non-public symbol set has never loaded.
const EXCLUDED_RETRY: Duration = Duration::from_secs(5);

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

/// Shared fan-out point between the single Redis subscriber and every socket.
pub struct WsHub {
    tx: broadcast::Sender<Arc<str>>,
    /// Symbols whose updates are never forwarded (non-public classes).
    /// `None` until the first successful load; until then no update frame is
    /// forwarded at all, so a non-public symbol cannot leak at boot or while
    /// the database is unreachable.
    excluded: RwLock<Option<Arc<HashSet<String>>>>,
    /// Live sockets across all IPs, for the global cap.
    active: AtomicUsize,
}

impl WsHub {
    pub fn new(capacity: usize) -> Arc<Self> {
        let (tx, _) = broadcast::channel(capacity);
        Arc::new(Self {
            tx,
            excluded: RwLock::new(None),
            active: AtomicUsize::new(0),
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Arc<str>> {
        self.tx.subscribe()
    }

    /// Sockets currently subscribed to the fan-out.
    pub fn receiver_count(&self) -> usize {
        self.tx.receiver_count()
    }

    pub fn set_excluded(&self, symbols: HashSet<String>) {
        *self.excluded.write().expect("ws excluded poisoned") = Some(Arc::new(symbols));
    }

    /// True once the non-public symbol set has loaded at least once.
    pub fn excluded_loaded(&self) -> bool {
        self.excluded
            .read()
            .expect("ws excluded poisoned")
            .is_some()
    }

    fn excluded(&self) -> Option<Arc<HashSet<String>>> {
        self.excluded.read().expect("ws excluded poisoned").clone()
    }

    /// Translate one raw engine payload and broadcast it. Returns the op label
    /// when a frame was produced (even with zero receivers), `None` when the
    /// payload was skipped.
    pub fn publish_raw(&self, payload: &str) -> Option<&'static str> {
        let excluded = self.excluded();
        let (json, op) = translate_engine_frame(payload, excluded.as_deref())?;
        // `send` only errors when there are no receivers, which is normal.
        let _ = self.tx.send(Arc::from(json));
        metrics::counter!("pegana_ws_fanout_frames_total", "op" => op).increment(1);
        Some(op)
    }

    /// Reserve a global slot; `false` at the cap.
    fn try_reserve_global(&self, cap: usize) -> bool {
        self.active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < cap).then_some(n + 1)
            })
            .is_ok()
    }

    fn release_global(&self) {
        let _ = self
            .active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                Some(n.saturating_sub(1))
            });
    }
}

/// Engine frame (`pegana:discount` payload) → serialized client frame.
/// `None` for non-JSON, unknown kinds, empty assets and excluded symbols.
/// `excluded` is `None` while the non-public set has not loaded yet; every
/// update is dropped then (heartbeats still pass), because no symbol can be
/// proven public.
fn translate_engine_frame(
    payload: &str,
    excluded: Option<&HashSet<String>>,
) -> Option<(String, &'static str)> {
    let value: serde_json::Value = match serde_json::from_str(payload) {
        Ok(v) => v,
        Err(e) => {
            debug!(?e, "ws skip non-json pubsub frame");
            return None;
        }
    };
    let (frame, op) = match value.get("kind").and_then(|v| v.as_str()) {
        Some("update") => {
            let asset = value
                .get("asset")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let Some(excluded) = excluded else {
                debug!(%asset, "ws drop update: non-public symbol set not loaded yet");
                return None;
            };
            if asset.is_empty() || excluded.contains(&asset) {
                return None;
            }
            let mut payload_obj = value;
            if let Some(obj) = payload_obj.as_object_mut() {
                obj.remove("kind");
                obj.remove("asset");
            }
            (
                ServerMsg::Update {
                    asset,
                    payload: payload_obj,
                },
                "update",
            )
        }
        Some("heartbeat") => (
            ServerMsg::Heartbeat {
                ts: value.get("ts").cloned().unwrap_or(serde_json::Value::Null),
            },
            "heartbeat",
        ),
        _ => return None,
    };
    serde_json::to_string(&frame).ok().map(|j| (j, op))
}

/// Why [`pump_frames`] stopped reading a subscription.
#[derive(Debug, PartialEq, Eq)]
enum PumpEnd {
    /// The Redis stream closed.
    Ended,
    /// No frame (not even an engine heartbeat) arrived within the silence
    /// window: treat the connection as half-open and resubscribe.
    Silent,
}

/// Feed every payload of one subscription into the hub until the stream ends
/// or stays silent for `silence`. The timeout restarts on every frame.
async fn pump_frames<S, E>(stream: &mut S, hub: &WsHub, silence: Duration) -> PumpEnd
where
    S: futures::Stream<Item = Result<String, E>> + Unpin,
    E: std::fmt::Debug,
{
    loop {
        match tokio::time::timeout(silence, stream.next()).await {
            Err(_) => return PumpEnd::Silent,
            Ok(None) => return PumpEnd::Ended,
            Ok(Some(Ok(p))) => {
                hub.publish_raw(&p);
            }
            Ok(Some(Err(e))) => warn!(?e, "ws bad redis payload"),
        }
    }
}

/// Hold the ONE Redis subscription for the process and feed the hub. Reconnects
/// with capped exponential backoff, and resubscribes when the subscription goes
/// silent for [`FANOUT_SILENCE`] (a half-open connection never ends the stream
/// on its own). Sockets stay open across a Redis blip and simply see no frames
/// (no heartbeat) until it returns.
pub fn spawn_redis_fanout(client: redis::Client, hub: Arc<WsHub>) {
    tokio::spawn(async move {
        let mut backoff = FANOUT_BACKOFF_MIN;
        loop {
            match client.get_async_pubsub().await {
                Ok(mut pubsub) => match pubsub.subscribe(channels::DISCOUNT).await {
                    Ok(()) => {
                        info!("ws fan-out subscribed to {}", channels::DISCOUNT);
                        metrics::gauge!("pegana_ws_fanout_connected").set(1.0);
                        backoff = FANOUT_BACKOFF_MIN;
                        let end = {
                            let stream = pubsub.on_message().map(|m| m.get_payload::<String>());
                            let mut stream = std::pin::pin!(stream);
                            pump_frames(&mut stream, &hub, FANOUT_SILENCE).await
                        };
                        match end {
                            PumpEnd::Ended => warn!("ws fan-out redis stream ended; reconnecting"),
                            PumpEnd::Silent => {
                                metrics::counter!("pegana_ws_fanout_stalls_total").increment(1);
                                warn!(
                                    silence_secs = FANOUT_SILENCE.as_secs(),
                                    "ws fan-out redis subscription silent; dropping it and resubscribing"
                                );
                            }
                        }
                        // `pubsub` drops at the end of this arm, closing the
                        // stalled connection before the next attempt.
                    }
                    Err(e) => warn!(?e, "ws fan-out subscribe failed"),
                },
                Err(e) => warn!(?e, "ws fan-out pubsub open failed"),
            }
            metrics::gauge!("pegana_ws_fanout_connected").set(0.0);
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(FANOUT_BACKOFF_MAX);
        }
    });
}

/// Load the symbols whose class is not public into the hub. Returns whether the
/// load succeeded; a failure keeps the previous set (or none at all).
pub async fn load_excluded(pg: &sqlx::PgPool, hub: &WsHub) -> bool {
    let rows: Result<Vec<String>, _> =
        sqlx::query_scalar("SELECT symbol FROM assets WHERE class::text = ANY($1::text[])")
            .bind(
                crate::schema::NON_PUBLIC_CLASSES
                    .iter()
                    .map(|s| s.to_string())
                    .collect::<Vec<_>>(),
            )
            .fetch_all(pg)
            .await;
    match rows {
        Ok(symbols) => {
            hub.set_excluded(symbols.into_iter().collect());
            true
        }
        Err(e) => {
            warn!(error = %e, "ws excluded-symbol load failed");
            false
        }
    }
}

/// Periodically refresh the non-public symbol set, so the WS stream drops them
/// exactly like the REST surface does. Retries every [`EXCLUDED_RETRY`] while
/// the set has never loaded (updates are withheld until then).
pub fn spawn_excluded_refresh(pg: sqlx::PgPool, hub: Arc<WsHub>) {
    tokio::spawn(async move {
        loop {
            let wait = if hub.excluded_loaded() {
                EXCLUDED_REFRESH
            } else {
                EXCLUDED_RETRY
            };
            tokio::time::sleep(wait).await;
            load_excluded(&pg, &hub).await;
        }
    });
}

/// JSON rejection for the handshake: the same `{error, message}` envelope as
/// every other error, plus `Retry-After` on capacity rejections.
fn ws_reject(status: StatusCode, code: &str, message: &str, retry_after: Option<u64>) -> Response {
    let body = ApiError {
        error: code.to_string(),
        message: message.to_string(),
        asset: None,
    };
    let mut resp = (status, Json(body)).into_response();
    if let Some(secs) = retry_after {
        if let Ok(v) = HeaderValue::from_str(&secs.to_string()) {
            resp.headers_mut().insert(header::RETRY_AFTER, v);
        }
    }
    resp
}

/// `GET /v1/ws` — upgrade to a WebSocket carrying the live peg-state stream.
///
/// Not a JSON endpoint: a successful handshake returns `101 Switching
/// Protocols`. After upgrade the server pushes `{op:"update", ...}` and
/// `{op:"heartbeat", ts}` frames; the client may send `{op:"ping"}` (→ `pong`)
/// and `{op:"subscribe"|"unsubscribe", assets:[...]}`. Browsers must present an
/// allowlisted `Origin`; server-to-server tools may omit it. Every rejection
/// is the JSON `{error, message}` envelope; the 429 and 503 also carry
/// `Retry-After`.
#[utoipa::path(
    get,
    path = "/v1/ws",
    tag = "WebSocket",
    responses(
        (status = 101, description = "Switching Protocols — WebSocket established"),
        (status = 400, description = "ws_upgrade_required: not a valid WebSocket upgrade request", body = ApiError),
        (status = 403, description = "origin_not_allowed: Origin present but not on the allowlist", body = ApiError),
        (status = 429, description = "ws_cap_exceeded: per-IP connection cap (20) reached; see Retry-After", body = ApiError),
        (status = 503, description = "ws_capacity: server-wide connection cap reached; see Retry-After", body = ApiError),
    )
)]
pub async fn ws_handler(
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
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
            return ws_reject(
                StatusCode::FORBIDDEN,
                "origin_not_allowed",
                "origin not allowed",
                None,
            );
        }
    }

    let ws = match ws {
        Ok(ws) => ws,
        Err(rej) => {
            metrics::counter!("pegana_ws_rejected_total", "reason" => "not_upgrade").increment(1);
            return ws_reject(
                StatusCode::BAD_REQUEST,
                "ws_upgrade_required",
                &format!("not a WebSocket upgrade request: {rej}"),
                None,
            );
        }
    };

    // Honor X-Forwarded-For so we count by real client IP behind Caddy.
    let ip = client_ip(&headers, addr);

    // Reserve a connection slot. Rejection is cheap (no upgrade performed).
    if !try_reserve(&state.ws_per_ip, ip, WS_MAX_PER_IP) {
        metrics::counter!("pegana_ws_rejected_total", "reason" => "per_ip_cap").increment(1);
        return ws_reject(
            StatusCode::TOO_MANY_REQUESTS,
            "ws_cap_exceeded",
            &format!("too many ws connections from this address (max {WS_MAX_PER_IP})"),
            Some(WS_RETRY_AFTER_SECS),
        );
    }
    // Server-wide cap: answer a clean 503 long before the process could run
    // out of file descriptors (which would fail REST accepts too).
    if !state.ws_hub.try_reserve_global(WS_MAX_TOTAL) {
        release(&state.ws_per_ip, ip);
        metrics::counter!("pegana_ws_rejected_total", "reason" => "global_cap").increment(1);
        return ws_reject(
            StatusCode::SERVICE_UNAVAILABLE,
            "ws_capacity",
            "the live stream is at capacity; retry shortly",
            Some(WS_RETRY_AFTER_SECS),
        );
    }

    // Hold the slot guard across the upgrade so both reservations are freed on
    // BOTH paths: when `handle` returns (success) AND when this closure is
    // dropped without ever running (a failed/aborted upgrade — which previously
    // leaked the slot). Ownership moves into the closure alongside `state`/`ip`.
    let slot = WsSlotGuard {
        state: state.clone(),
        ip,
    };
    ws.on_upgrade(move |socket| handle(socket, state, ip, slot))
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
    // The per-IP + global slot reservation, moved in from `ws_handler`. Held for
    // the whole connection; freed when this fn returns (any exit path) via its
    // Drop. Kept as a param — not reconstructed here — so a failed upgrade that
    // never calls `handle` still releases it (see WsSlotGuard).
    _slot: WsSlotGuard,
) {
    info!(?client, "ws client connected");
    metrics::gauge!("pegana_ws_clients_active").increment(1.0);
    // Decrement the active-clients gauge on any exit path (early return, break,
    // drop). The slot release is handled by `_slot` above.
    let _gauge_guard = WsGaugeGuard;

    // A receiver on the shared fan-out: no per-socket Redis connection.
    let mut frames = state.ws_hub.subscribe();
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
            frame = frames.recv() => {
                match frame {
                    Ok(json) => {
                        if socket.send(Message::Text(json.to_string())).await.is_err() {
                            break;
                        }
                        metrics::counter!("pegana_ws_forwarded_total").increment(1);
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        // A slow socket fell a full buffer behind: skip ahead.
                        // The next update per asset carries its full state.
                        metrics::counter!("pegana_ws_lagged_frames_total").increment(skipped);
                        debug!(?client, skipped, "ws receiver lagged");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
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
        self.state.ws_hub.release_global();
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
    fn engine_frames_translate_once_and_drop_excluded_assets() {
        let excluded: HashSet<String> = ["xSOL".to_string()].into_iter().collect();
        let (json, op) = translate_engine_frame(
            r#"{"kind":"update","asset":"jitoSOL","state":"PEGGED","discount":"0.000951"}"#,
            Some(&excluded),
        )
        .expect("update frame");
        assert_eq!(op, "update");
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["op"], "update");
        assert_eq!(v["asset"], "jitoSOL");
        assert_eq!(v["payload"]["discount"], "0.000951");
        assert!(v["payload"].get("kind").is_none());
        assert!(v["payload"].get("asset").is_none());

        // xSOL (synth_lev) is not public: never forwarded.
        assert!(translate_engine_frame(
            r#"{"kind":"update","asset":"xSOL","discount":"-0.358389"}"#,
            Some(&excluded)
        )
        .is_none());
        let (hb, op) = translate_engine_frame(
            r#"{"kind":"heartbeat","ts":"2026-10-21T12:00:00.000Z"}"#,
            Some(&excluded),
        )
        .unwrap();
        assert_eq!(op, "heartbeat");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&hb).unwrap()["ts"],
            "2026-10-21T12:00:00.000Z"
        );
        assert!(translate_engine_frame("not json", Some(&excluded)).is_none());
        assert!(
            translate_engine_frame(r#"{"kind":"update","asset":""}"#, Some(&excluded)).is_none()
        );
        assert!(translate_engine_frame(r#"{"kind":"other"}"#, Some(&excluded)).is_none());
    }

    #[test]
    fn updates_are_withheld_until_the_non_public_set_loads() {
        let hub = WsHub::new(8);
        let mut rx = hub.subscribe();
        assert!(!hub.excluded_loaded());
        // Not loaded: no update is provably public, so none goes out.
        assert_eq!(
            hub.publish_raw(r#"{"kind":"update","asset":"xSOL","discount":"-0.35"}"#),
            None
        );
        assert_eq!(
            hub.publish_raw(r#"{"kind":"update","asset":"jitoSOL","discount":"0.0009"}"#),
            None
        );
        // Heartbeats carry no asset and still flow.
        assert_eq!(
            hub.publish_raw(r#"{"kind":"heartbeat","ts":"2026-10-21T12:00:00Z"}"#),
            Some("heartbeat")
        );
        assert!(rx.try_recv().unwrap().contains("heartbeat"));
        assert!(rx.try_recv().is_err());

        hub.set_excluded(["xSOL".to_string()].into_iter().collect());
        assert!(hub.excluded_loaded());
        assert_eq!(
            hub.publish_raw(r#"{"kind":"update","asset":"xSOL","discount":"-0.35"}"#),
            None
        );
        assert_eq!(
            hub.publish_raw(r#"{"kind":"update","asset":"jitoSOL","discount":"0.0009"}"#),
            Some("update")
        );
        assert!(rx.try_recv().unwrap().contains("jitoSOL"));
    }

    const HB: &str = r#"{"kind":"heartbeat","ts":"2026-10-21T12:00:00Z"}"#;

    #[tokio::test]
    async fn pump_resubscribes_when_the_subscription_goes_silent() {
        let hub = WsHub::new(8);
        let mut rx = hub.subscribe();
        let (tx, mut stream) = futures::channel::mpsc::unbounded::<Result<String, ()>>();
        tx.unbounded_send(Ok(HB.to_string())).unwrap();
        // The sender stays alive and silent, like a half-open connection:
        // the stream never ends on its own.
        let end = pump_frames(&mut stream, &hub, Duration::from_millis(50)).await;
        assert_eq!(end, PumpEnd::Silent);
        assert!(rx.try_recv().unwrap().contains("heartbeat"));
        drop(tx);
    }

    #[tokio::test]
    async fn pump_silence_window_restarts_on_every_frame() {
        let hub = WsHub::new(16);
        let mut rx = hub.subscribe();
        let (tx, mut stream) = futures::channel::mpsc::unbounded::<Result<String, ()>>();
        tokio::spawn(async move {
            // 6 frames 30ms apart: 180ms in total, well past the 80ms window,
            // but no single gap reaches it.
            for _ in 0..6 {
                tx.unbounded_send(Ok(HB.to_string())).unwrap();
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
            tx.unbounded_send(Err(())).unwrap();
        });
        let end = pump_frames(&mut stream, &hub, Duration::from_millis(80)).await;
        assert_eq!(
            end,
            PumpEnd::Ended,
            "a live stream must not count as silent"
        );
        let mut n = 0;
        while rx.try_recv().is_ok() {
            n += 1;
        }
        assert_eq!(n, 6, "every frame forwarded; the bad payload skipped");
    }

    #[test]
    fn global_cap_reserves_and_releases() {
        let hub = WsHub::new(8);
        assert!(hub.try_reserve_global(2));
        assert!(hub.try_reserve_global(2));
        assert!(!hub.try_reserve_global(2), "third socket over the cap");
        hub.release_global();
        assert!(hub.try_reserve_global(2));
        hub.release_global();
        hub.release_global();
        hub.release_global(); // never underflows
        assert_eq!(hub.active.load(Ordering::Acquire), 0);
    }

    #[test]
    fn release_on_unknown_ip_is_noop() {
        let map: PerIpMap = Mutex::new(HashMap::new());
        release(&map, IpAddr::V4(Ipv4Addr::LOCALHOST)); // must not panic
        assert!(map.lock().unwrap().is_empty());
    }
}

/// In-process end-to-end test of the shared fan-out: real axum server, real
/// WebSocket clients, no Redis and no Postgres (the pool is lazy and never
/// used on this path). Measures the per-socket file-descriptor cost.
#[cfg(test)]
mod fanout_tests {
    use super::*;
    use axum::{routing::get, Router};
    use std::collections::HashMap;
    use std::sync::Mutex;
    use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message as TMsg};

    fn test_state() -> Arc<AppState> {
        let pg = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://u:p@127.0.0.1:1/none")
            .expect("lazy pool");
        Arc::new(AppState {
            pg,
            // Never connected: the WS path must not touch Redis per socket.
            redis: redis::Client::open("redis://127.0.0.1:1").expect("redis url"),
            ws_hub: WsHub::new(WS_BROADCAST_CAPACITY),
            started_at: chrono::Utc::now(),
            allowed_origins: Arc::new(vec!["https://pegana.xyz".to_string()]),
            ws_per_ip: Arc::new(Mutex::new(HashMap::new())),
            feature_public_alerts: false,
        })
    }

    async fn serve(state: Arc<AppState>) -> SocketAddr {
        let app = Router::new()
            .route("/v1/ws", get(ws_handler))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .unwrap();
        });
        addr
    }

    fn request(
        addr: SocketAddr,
        xff: &str,
        origin: Option<&str>,
    ) -> tokio_tungstenite::tungstenite::handshake::client::Request {
        let mut req = format!("ws://{addr}/v1/ws").into_client_request().unwrap();
        req.headers_mut()
            .insert("x-forwarded-for", xff.parse().unwrap());
        if let Some(o) = origin {
            req.headers_mut().insert("origin", o.parse().unwrap());
        }
        req
    }

    /// Open file descriptors of this process (`None` where unsupported).
    fn open_fds() -> Option<usize> {
        ["/proc/self/fd", "/dev/fd"]
            .iter()
            .find_map(|d| std::fs::read_dir(d).ok().map(|r| r.count()))
    }

    async fn wait_for_receivers(hub: &WsHub, n: usize) {
        for _ in 0..200 {
            if hub.receiver_count() == n {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("expected {n} receivers, got {}", hub.receiver_count());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn many_sockets_share_one_fanout_at_one_fd_each() {
        const N: usize = 64;
        let state = test_state();
        let hub = state.ws_hub.clone();
        hub.set_excluded(["xSOL".to_string()].into_iter().collect());
        let addr = serve(state).await;
        // Warm-up socket so lazily-created runtime fds are not counted.
        let (warm, _) = tokio_tungstenite::connect_async(request(addr, "10.9.9.9", None))
            .await
            .unwrap();
        wait_for_receivers(&hub, 1).await;

        let before = open_fds();
        let mut clients = Vec::with_capacity(N);
        for i in 0..N {
            // Distinct client IPs (via X-Forwarded-For) so the per-IP cap of 20
            // does not apply here.
            let xff = format!("10.0.{}.{}", i / 250, i % 250 + 1);
            let (c, resp) = tokio_tungstenite::connect_async(request(addr, &xff, None))
                .await
                .unwrap();
            assert_eq!(resp.status(), 101);
            clients.push(c);
        }
        wait_for_receivers(&hub, N + 1).await;
        let after = open_fds();

        if let (Some(b), Some(a)) = (before, after) {
            let per_socket = (a.saturating_sub(b)) as f64 / N as f64;
            // In-process, each socket holds TWO fds: the client end and the
            // server end. A dedicated Redis subscriber per socket would make it
            // three. Allow a little slack for unrelated fds from parallel tests.
            println!(
                "ws fan-out: {N} sockets, {} fds, {per_socket:.2} fds/socket",
                a - b
            );
            assert!(
                per_socket < 2.5,
                "expected ~2 fds per in-process socket, measured {per_socket:.2}"
            );
        }

        // One engine frame reaches every socket; the excluded asset reaches none.
        hub.publish_raw(r#"{"kind":"update","asset":"xSOL","discount":"-0.35"}"#);
        hub.publish_raw(r#"{"kind":"update","asset":"jitoSOL","discount":"0.000951"}"#);
        for c in clients.iter_mut() {
            let msg = tokio::time::timeout(Duration::from_secs(5), c.next())
                .await
                .expect("frame in time")
                .expect("stream open")
                .expect("ws ok");
            let TMsg::Text(t) = msg else {
                panic!("text frame expected, got {msg:?}");
            };
            let v: serde_json::Value = serde_json::from_str(&t).unwrap();
            assert_eq!(v["asset"], "jitoSOL", "xSOL must be filtered: {t}");
        }

        // Closing sockets drops their receivers (no leak).
        for mut c in clients {
            let _ = c.close(None).await;
        }
        drop(warm);
        for _ in 0..200 {
            if hub.receiver_count() == 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(hub.receiver_count(), 0);
        assert_eq!(hub.active.load(Ordering::Acquire), 0, "global slots freed");
    }

    #[tokio::test]
    async fn handshake_rejections_are_json_with_retry_after() {
        let state = test_state();
        let addr = serve(state.clone()).await;

        // Disallowed Origin -> 403 JSON envelope.
        let err = tokio_tungstenite::connect_async(request(
            addr,
            "10.1.1.1",
            Some("https://evil.example"),
        ))
        .await
        .unwrap_err();
        let tokio_tungstenite::tungstenite::Error::Http(resp) = err else {
            panic!("http error expected, got {err:?}");
        };
        assert_eq!(resp.status(), 403);
        let body: serde_json::Value =
            serde_json::from_slice(resp.body().as_deref().unwrap_or_default()).unwrap();
        assert_eq!(body["error"], "origin_not_allowed");
        assert!(body["message"].is_string());

        // Per-IP cap -> 429 JSON + Retry-After.
        let mut held = Vec::new();
        for _ in 0..WS_MAX_PER_IP {
            let (c, _) = tokio_tungstenite::connect_async(request(addr, "10.2.2.2", None))
                .await
                .unwrap();
            held.push(c);
        }
        let err = tokio_tungstenite::connect_async(request(addr, "10.2.2.2", None))
            .await
            .unwrap_err();
        let tokio_tungstenite::tungstenite::Error::Http(resp) = err else {
            panic!("http error expected, got {err:?}");
        };
        assert_eq!(resp.status(), 429);
        assert_eq!(
            resp.headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok()),
            Some("30")
        );
        let body: serde_json::Value =
            serde_json::from_slice(resp.body().as_deref().unwrap_or_default()).unwrap();
        assert_eq!(body["error"], "ws_cap_exceeded");

        // A plain GET (no upgrade headers) -> 400 JSON, not axum's text/plain.
        let plain = reqwest::get(format!("http://{addr}/v1/ws")).await.unwrap();
        assert_eq!(plain.status(), 400);
        let body: serde_json::Value = plain.json().await.unwrap();
        assert_eq!(body["error"], "ws_upgrade_required");
        drop(held);
    }
}
