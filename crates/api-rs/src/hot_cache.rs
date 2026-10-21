//! In-process, short-TTL, single-flight response cache for the hot anonymous
//! read routes.
//!
//! WHY THIS EXISTS: apart from `/v1/calibration` (Redis, written by a
//! background task) and the unfiltered `/v1/assets` list (Redis, pre-warmed),
//! every anonymous read reached Postgres, and Caddy has no response cache. The
//! per-IP rate limit was therefore the only thing protecting the database, so
//! it had to stay low (60/min), and browsers behind a shared IP (offices,
//! campuses, mobile CGNAT) hit 429 on the first-party dashboard.
//!
//! With this layer, each `(route, path, normalised query)` key costs at most
//! ONE handler run (and so one set of DB queries) per TTL, no matter how many
//! clients ask. Concurrent misses for the same key are coalesced: one request
//! (the leader) runs the handler; the others wait for its result.
//!
//! Correctness contract:
//! - Only `200` responses are stored. Errors (4xx/5xx), `304`s and degraded
//!   bodies (`Cache-Control: no-store`, e.g. the assets-list last-known-good
//!   fallback) are never stored. Requests that joined a flight that ended in
//!   an error get that same response (they asked during the same query), but
//!   the error is not served to anyone who arrives later.
//! - Status, headers and body bytes are replayed exactly as the handler
//!   produced them, so `generated_at` / `updated_at` keep stating when the data
//!   was computed, not when it was served. A hit adds an `Age` header (RFC 9111
//!   section 5.1), so a downstream cache honouring `max-age` does not extend
//!   the total staleness past what the handler advertised.
//! - The TTL is `min(route TTL, Cache-Control max-age)`; `no-store`,
//!   `no-cache` and `private` responses are not stored.
//! - The layer sits INSIDE the rate limiter, so a cached body never carries
//!   rate-limit headers: they are stamped per request, after this layer.
//!   `x-request-id`, CORS and compression are applied outside it as well.
//! - Gating (xSOL / non-public classes, the ADR-0020 index switch) runs in the
//!   handlers, before anything is stored, and the key includes the full path,
//!   so a 404 for one symbol can never be served for another.
//! - A query parameter the route does not know, or a repeated one, bypasses
//!   the cache, so junk parameters cannot flood it or evict the hot keys.
//! - Only GET is cached. HEAD (and every other method) passes straight
//!   through to the handler: answering HEAD from a cached GET would need the
//!   body length re-derived by hand, and nothing first-party sends HEAD. It is
//!   rate-limited like any other request.
//! - Conditional requests (`If-None-Match` / `If-Modified-Since`) are answered
//!   from the cached `200` with the same rules `/v1/peg/feed` applies itself.

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use axum::body::{Body, Bytes};
use axum::extract::{MatchedPath, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use tokio::sync::watch;

/// Per-route caching policy.
#[derive(Debug)]
pub struct RoutePolicy {
    /// The axum route template (what `MatchedPath` reports). Also the
    /// low-cardinality `route` label on the metrics.
    pub route: &'static str,
    /// Upper bound on how long a `200` is reused. The effective TTL is also
    /// capped by the response's own `max-age`.
    pub ttl: Duration,
    /// Query parameters the handler reads. Any other parameter bypasses the
    /// cache (see the module docs).
    pub params: &'static [&'static str],
}

const fn secs(n: u64) -> Duration {
    Duration::from_secs(n)
}

/// The cached routes. Data cadence: the engine republishes state on every
/// source message (sources poll every 15-60s, Pyth streams) plus a 5s
/// heartbeat, and the handlers already advertise `max-age` 3-10s. So 2-5s
/// stays inside the data cadence and inside every advertised `max-age`.
///
/// Not cached, deliberately: `/v1/assets/{symbol}/history` (keys carry
/// client-computed timestamps, so they are rarely shared), `/v1/audit.csv`
/// (streamed, has its own 10/min limit), the audit receipts (their own
/// `Cache-Control` lets clients cache them: a year once settled, 60s while the
/// on-chain commit is pending), `/healthz` (no DB).
pub const POLICIES: &[RoutePolicy] = &[
    // Already Redis-backed and pre-warmed every 4s (5s Redis TTL). 3s here keeps
    // worst-case staleness, Redis plus this layer, under ~8s, while removing the
    // Redis round trip and the JSON re-encode from every request.
    RoutePolicy {
        route: "/v1/assets",
        ttl: secs(3),
        params: &["class", "peg"],
    },
    RoutePolicy {
        route: "/v1/assets/:symbol",
        ttl: secs(5),
        params: &[],
    },
    RoutePolicy {
        route: "/v1/assets/by-mint/:mint",
        ttl: secs(5),
        params: &[],
    },
    // The handler advertises max-age=3 (no 15-min freshness bound), so 3s.
    RoutePolicy {
        route: "/v1/assets/:symbol/state",
        ttl: secs(3),
        params: &[],
    },
    RoutePolicy {
        route: "/v1/assets/by-mint/:mint/state",
        ttl: secs(3),
        params: &[],
    },
    // Hourly leverage data; 5s is far inside its cadence.
    RoutePolicy {
        route: "/v1/assets/:symbol/loop-exposure",
        ttl: secs(5),
        params: &[],
    },
    RoutePolicy {
        route: "/v1/assets/:symbol/simulate-depeg",
        ttl: secs(5),
        params: &["shock_bps"],
    },
    // Shares the assets-list Redis key, so the same 3s as `/v1/assets`.
    RoutePolicy {
        route: "/v1/peg/feed",
        ttl: secs(3),
        params: &[],
    },
    RoutePolicy {
        route: "/v1/peg/feed/by-mint/:mint",
        ttl: secs(5),
        params: &[],
    },
    // Five aggregate queries per request; the handler advertises max-age=10.
    RoutePolicy {
        route: "/v1/stats",
        ttl: secs(5),
        params: &[],
    },
    // Receipts are written on state transitions, minutes to days apart.
    RoutePolicy {
        route: "/v1/audit",
        ttl: secs(5),
        params: &[
            "limit",
            "exclude_pegged",
            "state",
            "asset",
            "since",
            "until",
            "before",
            "before_id",
        ],
    },
    // Redis-backed already (60s writer); this only saves the Redis round trip.
    RoutePolicy {
        route: "/v1/calibration",
        ttl: secs(5),
        params: &[],
    },
    RoutePolicy {
        route: "/v1/methodology/current",
        ttl: secs(5),
        params: &[],
    },
    // Exempt from the rate limiter (monitors poll it freely) yet it runs six
    // queries plus a Redis PING. 2s caps it at 0.5 runs/s however hard it is
    // polled; a 503 (not ready) is never stored, so an outage shows at once,
    // and recovery shows within 2s.
    RoutePolicy {
        route: "/readyz",
        ttl: secs(2),
        params: &[],
    },
];

/// Hard bounds on what the hot cache may hold.
pub const MAX_ENTRIES: usize = 1024;
/// Total bytes of stored bodies (+ headers, approximately).
pub const MAX_BYTES: usize = 64 * 1024 * 1024;
/// A body larger than this is served but not stored.
pub const MAX_ENTRY_BYTES: usize = 2 * 1024 * 1024;

// Compile-time guards: a TTL outside 1..=5s is a policy bug (longer than the
// data cadence, or a zero TTL that would silently disable the route).
const _: () = {
    let mut i = 0;
    while i < POLICIES.len() {
        let t = POLICIES[i].ttl.as_secs();
        assert!(t >= 1 && t <= 5, "hot-cache TTL must be 1-5s");
        i += 1;
    }
};

pub fn policy_for(route: &str) -> Option<&'static RoutePolicy> {
    POLICIES.iter().find(|p| p.route == route)
}

/// Why a request skipped the cache (metric label).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BypassReason {
    UnknownParam,
    RepeatedParam,
}

impl BypassReason {
    fn label(self) -> &'static str {
        match self {
            BypassReason::UnknownParam => "unknown_param",
            BypassReason::RepeatedParam => "repeated_param",
        }
    }
}

/// Cache key: the raw request path plus the decoded query pairs sorted by
/// name. The path (not the route template) is in the key, so
/// `/v1/assets/USDC` and `/v1/assets/USDe` never share an entry.
pub fn cache_key(
    path: &str,
    query: Option<&str>,
    policy: &RoutePolicy,
) -> Result<String, BypassReason> {
    let mut pairs: Vec<(String, String)> = Vec::new();
    if let Some(q) = query {
        for (k, v) in form_urlencoded::parse(q.as_bytes()) {
            if !policy.params.contains(&k.as_ref()) {
                return Err(BypassReason::UnknownParam);
            }
            if pairs.iter().any(|(seen, _)| seen.as_str() == k.as_ref()) {
                return Err(BypassReason::RepeatedParam);
            }
            pairs.push((k.into_owned(), v.into_owned()));
        }
    }
    pairs.sort();
    // Length-prefixed pairs (`\0<len>:<name><len>:<value>`): a decoded value
    // may contain any byte (`%00`, `%26`, `%3D`), so plain separators would let
    // `asset=X%00limit%3D1` collide with `asset=X&limit=1`. With explicit
    // lengths no value can impersonate a pair boundary.
    use std::fmt::Write as _;
    let mut key = String::with_capacity(path.len() + 32);
    key.push_str(path);
    for (k, v) in pairs {
        let _ = write!(key, "\0{}:{}{}:{}", k.len(), k, v.len(), v);
    }
    Ok(key)
}

// ── Generic single-flight TTL cache ──────────────────────────────────────

/// How a lookup was satisfied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lookup {
    /// Served from a stored value.
    Hit,
    /// This caller ran the loader.
    Miss,
    /// Another caller was already loading this key; this one shared its result.
    Coalesced,
    /// Not cached; the caller ran the loader itself and nothing was stored.
    Bypass(BypassCause),
}

/// Why a lookup fell back to running the loader directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BypassCause {
    /// Every slot is an in-flight load; nothing can be evicted.
    Capacity,
    /// The leader's task died (panic) without a result.
    LeaderFailed,
    /// The leader took longer than the waiter timeout.
    WaitTimeout,
}

impl BypassCause {
    fn label(self) -> &'static str {
        match self {
            BypassCause::Capacity => "capacity",
            BypassCause::LeaderFailed => "leader_failed",
            BypassCause::WaitTimeout => "wait_timeout",
        }
    }
}

/// How long a waiter shares a leader's load before running its own. Bounds
/// the latency a single slow query can add to every coalesced request (the
/// statement timeout is 30s); on expiry the waiter runs the handler itself
/// and stores nothing.
pub const WAIT_TIMEOUT: Duration = Duration::from_secs(3);

/// Size accounting for the byte budget.
pub trait Weigh {
    fn weight(&self) -> usize;
}

enum Slot<V> {
    Ready {
        value: V,
        expires_at: Instant,
        weight: usize,
    },
    Loading {
        generation: u64,
        rx: watch::Receiver<Option<V>>,
    },
}

struct Slots<V> {
    map: HashMap<String, Slot<V>>,
    bytes: usize,
}

/// A bounded TTL map with per-key single-flight loading.
pub struct SingleFlight<V> {
    slots: Mutex<Slots<V>>,
    max_entries: usize,
    max_bytes: usize,
    wait_timeout: Duration,
    generation: AtomicU64,
}

impl<V> SingleFlight<V>
where
    V: Clone + Weigh + Send + Sync + 'static,
{
    pub fn new(max_entries: usize, max_bytes: usize) -> Arc<Self> {
        Self::with_wait_timeout(max_entries, max_bytes, WAIT_TIMEOUT)
    }

    pub fn with_wait_timeout(
        max_entries: usize,
        max_bytes: usize,
        wait_timeout: Duration,
    ) -> Arc<Self> {
        Arc::new(Self {
            slots: Mutex::new(Slots {
                map: HashMap::new(),
                bytes: 0,
            }),
            max_entries,
            max_bytes,
            wait_timeout,
            generation: AtomicU64::new(0),
        })
    }

    /// A poisoned lock only means some thread panicked mid-update of plain
    /// bookkeeping; the map is still structurally sound, so keep serving.
    fn lock(&self) -> MutexGuard<'_, Slots<V>> {
        self.slots.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Number of stored and in-flight entries.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.lock().map.len()
    }

    /// Return the stored value for `key`, or run `load` once for all
    /// concurrent callers. `load` resolves to the value plus `Some(ttl)` when
    /// it may be stored, `None` when it must not.
    ///
    /// The loader runs on its own task: if the caller that started it goes
    /// away (client disconnect), the waiters still get their result.
    pub async fn get_or_load<F, Fut>(self: &Arc<Self>, key: String, load: F) -> (V, Lookup)
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = (V, Option<Duration>)> + Send + 'static,
    {
        enum Plan<V> {
            Hit(V),
            Wait(watch::Receiver<Option<V>>),
            Lead(u64, watch::Sender<Option<V>>),
            Bypass,
        }

        let plan = {
            let mut slots = self.lock();
            let now = Instant::now();
            match slots.map.get(&key) {
                Some(Slot::Ready {
                    value, expires_at, ..
                }) if *expires_at > now => Plan::Hit(value.clone()),
                Some(Slot::Loading { rx, .. }) => Plan::Wait(rx.clone()),
                _ => {
                    // Absent or expired. Drop the expired entry first so it
                    // does not count against the bounds.
                    remove_slot(&mut slots, &key);
                    if slots.map.len() >= self.max_entries {
                        self.make_room(&mut slots, now, 0);
                    }
                    if slots.map.len() < self.max_entries {
                        let generation = self.generation.fetch_add(1, Ordering::Relaxed);
                        let (tx, rx) = watch::channel(None);
                        slots
                            .map
                            .insert(key.clone(), Slot::Loading { generation, rx });
                        Plan::Lead(generation, tx)
                    } else {
                        Plan::Bypass
                    }
                }
            }
        };

        match plan {
            Plan::Hit(v) => (v, Lookup::Hit),
            Plan::Bypass => (load().await.0, Lookup::Bypass(BypassCause::Capacity)),
            Plan::Wait(mut rx) => {
                // Resolve to an owned value BEFORE any further await: the
                // watch `Ref` holds a lock guard and is not `Send`.
                let waited: Result<Option<V>, BypassCause> =
                    match tokio::time::timeout(self.wait_timeout, rx.wait_for(Option::is_some))
                        .await
                    {
                        Ok(Ok(v)) => Ok(v.clone()),
                        Ok(Err(_)) => Err(BypassCause::LeaderFailed),
                        Err(_) => Err(BypassCause::WaitTimeout),
                    };
                match waited {
                    Ok(Some(v)) => (v, Lookup::Coalesced),
                    Ok(None) => (load().await.0, Lookup::Bypass(BypassCause::LeaderFailed)),
                    Err(cause) => (load().await.0, Lookup::Bypass(cause)),
                }
            }
            Plan::Lead(generation, tx) => {
                let fut = load();
                let this = Arc::clone(self);
                let task = tokio::spawn(async move {
                    // Clears our `Loading` slot if the loader panics, so the
                    // key is not stuck in flight forever.
                    let guard = LoadingGuard {
                        cache: Arc::clone(&this),
                        key,
                        generation,
                    };
                    let (value, ttl) = fut.await;
                    this.finish(&guard.key, generation, &value, ttl);
                    let _ = tx.send(Some(value.clone()));
                    value
                });
                match task.await {
                    Ok(v) => (v, Lookup::Miss),
                    // Same outcome a panicking handler has without the cache.
                    Err(e) if e.is_panic() => std::panic::resume_unwind(e.into_panic()),
                    Err(e) => panic!("hot-cache loader task cancelled: {e}"),
                }
            }
        }
    }

    /// Store (or drop) the leader's result, if the slot is still ours.
    fn finish(&self, key: &str, generation: u64, value: &V, ttl: Option<Duration>) {
        let mut slots = self.lock();
        let ours = matches!(
            slots.map.get(key),
            Some(Slot::Loading { generation: g, .. }) if *g == generation
        );
        if !ours {
            return;
        }
        remove_slot(&mut slots, key);
        let weight = value.weight() + key.len();
        let Some(ttl) = ttl.filter(|t| !t.is_zero()) else {
            return;
        };
        if weight > self.max_bytes {
            return;
        }
        let now = Instant::now();
        if slots.bytes + weight > self.max_bytes {
            self.make_room(&mut slots, now, weight);
        }
        if slots.bytes + weight > self.max_bytes || slots.map.len() >= self.max_entries {
            return;
        }
        slots.bytes += weight;
        slots.map.insert(
            key.to_owned(),
            Slot::Ready {
                value: value.clone(),
                expires_at: now + ttl,
                weight,
            },
        );
    }

    /// Evict expired entries; then, while over either bound, the stored entry
    /// closest to expiry (the least valuable one). In-flight loads are never
    /// evicted.
    fn make_room(&self, slots: &mut Slots<V>, now: Instant, incoming: usize) {
        purge_expired(slots, now);
        while slots.map.len() >= self.max_entries || slots.bytes + incoming > self.max_bytes {
            let victim = slots
                .map
                .iter()
                .filter_map(|(k, s)| match s {
                    Slot::Ready { expires_at, .. } => Some((k, *expires_at)),
                    Slot::Loading { .. } => None,
                })
                .min_by_key(|(_, e)| *e)
                .map(|(k, _)| k.clone());
            match victim {
                Some(k) => remove_slot(slots, &k),
                None => break,
            }
        }
    }

    /// Drop every expired entry (the janitor calls this periodically so memory
    /// is returned even for keys nobody asks for again).
    pub fn purge_expired(&self) {
        let mut slots = self.lock();
        purge_expired(&mut slots, Instant::now());
    }
}

fn remove_slot<V>(slots: &mut Slots<V>, key: &str) {
    if let Some(Slot::Ready { weight, .. }) = slots.map.remove(key) {
        slots.bytes = slots.bytes.saturating_sub(weight);
    }
}

fn purge_expired<V>(slots: &mut Slots<V>, now: Instant) {
    let mut freed = 0usize;
    slots.map.retain(|_, s| match s {
        Slot::Ready {
            expires_at, weight, ..
        } if *expires_at <= now => {
            freed += *weight;
            false
        }
        _ => true,
    });
    slots.bytes = slots.bytes.saturating_sub(freed);
}

struct LoadingGuard<V>
where
    V: Clone + Weigh + Send + Sync + 'static,
{
    cache: Arc<SingleFlight<V>>,
    key: String,
    generation: u64,
}

impl<V> Drop for LoadingGuard<V>
where
    V: Clone + Weigh + Send + Sync + 'static,
{
    fn drop(&mut self) {
        let mut slots = self.cache.lock();
        let ours = matches!(
            slots.map.get(&self.key),
            Some(Slot::Loading { generation: g, .. }) if *g == self.generation
        );
        if ours {
            slots.map.remove(&self.key);
        }
    }
}

// ── HTTP layer ────────────────────────────────────────────────────────────

/// A buffered handler response.
#[derive(Debug)]
pub struct Captured {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
    captured_at: Instant,
}

impl Weigh for Arc<Captured> {
    fn weight(&self) -> usize {
        let headers: usize = self
            .headers
            .iter()
            .map(|(k, v)| k.as_str().len() + v.len())
            .sum();
        self.body.len() + headers
    }
}

/// The cache as the middleware state. `None` = disabled
/// (`API_HOT_CACHE_ENABLED=false`): every request passes straight through.
pub type ResponseCache = Option<Arc<SingleFlight<Arc<Captured>>>>;

pub fn new_response_cache() -> ResponseCache {
    Some(SingleFlight::new(MAX_ENTRIES, MAX_BYTES))
}

/// Purge expired entries every 30s and export the entry/byte gauges.
pub fn spawn_janitor(cache: ResponseCache) {
    let Some(cache) = cache else {
        return;
    };
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(30));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            cache.purge_expired();
            let (entries, bytes) = {
                let s = cache.lock();
                (s.map.len(), s.bytes)
            };
            metrics::gauge!("pegana_api_response_cache_entries").set(entries as f64);
            metrics::gauge!("pegana_api_response_cache_bytes").set(bytes as f64);
        }
    });
}

/// The TTL a response may be stored for, or `None` if it must not be.
pub fn storable_ttl(
    status: StatusCode,
    headers: &HeaderMap,
    body_len: usize,
    route_ttl: Duration,
) -> Option<Duration> {
    if status != StatusCode::OK || body_len > MAX_ENTRY_BYTES {
        return None;
    }
    // A Set-Cookie (none today) would be per client; never replay one.
    if headers.contains_key(header::SET_COOKIE) {
        return None;
    }
    let mut ttl = route_ttl;
    for value in headers.get_all(header::CACHE_CONTROL) {
        let Ok(value) = value.to_str() else {
            return None;
        };
        for directive in value.split(',') {
            let directive = directive.trim().to_ascii_lowercase();
            if directive == "no-store" || directive == "no-cache" || directive == "private" {
                return None;
            }
            if let Some(n) = directive
                .strip_prefix("max-age=")
                .or_else(|| directive.strip_prefix("s-maxage="))
            {
                match n.trim_matches('"').parse::<u64>() {
                    Ok(n) => ttl = ttl.min(Duration::from_secs(n)),
                    Err(_) => return None,
                }
            }
        }
    }
    (!ttl.is_zero()).then_some(ttl)
}

async fn capture(resp: Response, route_ttl: Duration) -> (Arc<Captured>, Option<Duration>) {
    let (parts, body) = resp.into_parts();
    // Every cached route builds its body in memory (Json or a String), so
    // collecting it costs nothing extra; there is no streaming route here.
    let captured = match axum::body::to_bytes(body, usize::MAX).await {
        Ok(body) => Captured {
            status: parts.status,
            headers: parts.headers,
            body,
            captured_at: Instant::now(),
        },
        Err(e) => {
            tracing::error!(error = %e, "hot-cache: failed to read the handler body");
            let resp = crate::error::ApiError::internal(e).into_response();
            let (parts, _) = resp.into_parts();
            Captured {
                status: parts.status,
                headers: parts.headers,
                body: Bytes::from_static(
                    br#"{"error":"internal","message":"internal server error"}"#,
                ),
                captured_at: Instant::now(),
            }
        }
    };
    let ttl = storable_ttl(
        captured.status,
        &captured.headers,
        captured.body.len(),
        route_ttl,
    );
    (Arc::new(captured), ttl)
}

/// The conditional request headers, removed from the request so the leader
/// always computes the full `200` that every caller can share.
#[derive(Default)]
struct Conditional {
    if_none_match: Option<HeaderValue>,
    if_modified_since: Option<HeaderValue>,
}

impl Conditional {
    fn take(headers: &mut HeaderMap) -> Self {
        Self {
            if_none_match: headers.remove(header::IF_NONE_MATCH),
            if_modified_since: headers.remove(header::IF_MODIFIED_SINCE),
        }
    }

    /// Same rules as `routes::peg::request_not_modified` (the only route that
    /// emits validators): If-None-Match wins; otherwise If-Modified-Since
    /// against Last-Modified at one-second precision.
    fn not_modified(&self, cached: &Captured) -> bool {
        if cached.status != StatusCode::OK {
            return false;
        }
        if self.if_none_match.is_none() && self.if_modified_since.is_none() {
            return false;
        }
        let Some(etag) = cached
            .headers
            .get(header::ETAG)
            .and_then(|v| v.to_str().ok())
        else {
            // Without an ETag only If-Modified-Since can match.
            return self.if_none_match.is_none() && self.modified_since_matches(cached);
        };
        let mut req = HeaderMap::new();
        if let Some(v) = &self.if_none_match {
            req.insert(header::IF_NONE_MATCH, v.clone());
        }
        if let Some(v) = &self.if_modified_since {
            req.insert(header::IF_MODIFIED_SINCE, v.clone());
        }
        crate::routes::peg::request_not_modified(&req, etag, last_modified(cached).as_ref())
    }

    fn modified_since_matches(&self, cached: &Captured) -> bool {
        let (Some(since), Some(lm)) = (self.if_modified_since.as_ref(), last_modified(cached))
        else {
            return false;
        };
        since
            .to_str()
            .ok()
            .and_then(|s| chrono::DateTime::parse_from_rfc2822(s).ok())
            .is_some_and(|since| lm.timestamp() <= since.timestamp())
    }
}

fn last_modified(cached: &Captured) -> Option<chrono::DateTime<chrono::Utc>> {
    cached
        .headers
        .get(header::LAST_MODIFIED)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| chrono::DateTime::parse_from_rfc2822(s).ok())
        .map(|d| d.with_timezone(&chrono::Utc))
}

fn render(cached: &Captured, lookup: Lookup, cond: &Conditional) -> Response {
    let mut resp = if cond.not_modified(cached) {
        let mut r = Response::new(Body::empty());
        *r.status_mut() = StatusCode::NOT_MODIFIED;
        let mut headers = cached.headers.clone();
        headers.remove(header::CONTENT_TYPE);
        headers.remove(header::CONTENT_LENGTH);
        *r.headers_mut() = headers;
        r
    } else {
        let mut r = Response::new(Body::from(cached.body.clone()));
        *r.status_mut() = cached.status;
        *r.headers_mut() = cached.headers.clone();
        r
    };
    if lookup == Lookup::Hit {
        let age = cached.captured_at.elapsed().as_secs();
        if let Ok(v) = HeaderValue::from_str(&age.to_string()) {
            resp.headers_mut().insert(header::AGE, v);
        }
    }
    resp
}

/// The middleware. Install it with `Router::layer` BEFORE (inside) the rate
/// limiter so `MatchedPath` is set and rate-limit headers stay per request.
pub async fn middleware(
    State(cache): State<ResponseCache>,
    mut req: Request,
    next: Next,
) -> Response {
    let Some(cache) = cache else {
        return next.run(req).await;
    };
    if req.method() != Method::GET {
        return next.run(req).await;
    }
    let Some(policy) = req
        .extensions()
        .get::<MatchedPath>()
        .and_then(|m| policy_for(m.as_str()))
    else {
        return next.run(req).await;
    };
    let key = match cache_key(req.uri().path(), req.uri().query(), policy) {
        Ok(k) => k,
        Err(reason) => {
            metrics::counter!(
                "pegana_api_response_cache_bypass_total",
                "route" => policy.route,
                "reason" => reason.label(),
            )
            .increment(1);
            return next.run(req).await;
        }
    };
    let cond = Conditional::take(req.headers_mut());
    let ttl = policy.ttl;
    let (cached, lookup) = cache
        .get_or_load(key, move || async move {
            capture(next.run(req).await, ttl).await
        })
        .await;
    let name = match lookup {
        Lookup::Hit => "pegana_api_response_cache_hits_total",
        Lookup::Miss => "pegana_api_response_cache_misses_total",
        Lookup::Coalesced => "pegana_api_response_cache_coalesced_total",
        Lookup::Bypass(_) => "pegana_api_response_cache_bypass_total",
    };
    if let Lookup::Bypass(cause) = lookup {
        metrics::counter!(name, "route" => policy.route, "reason" => cause.label()).increment(1);
    } else {
        metrics::counter!(name, "route" => policy.route).increment(1);
    }
    render(&cached, lookup, &cond)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[derive(Clone, Debug, PartialEq)]
    struct V(u32);
    impl Weigh for V {
        fn weight(&self) -> usize {
            8
        }
    }

    type BoxLoad = std::pin::Pin<Box<dyn Future<Output = (V, Option<Duration>)> + Send>>;

    fn counting_loader(
        calls: &Arc<AtomicUsize>,
        value: u32,
        ttl: Option<Duration>,
        delay: Duration,
    ) -> impl FnOnce() -> BoxLoad {
        let calls = Arc::clone(calls);
        move || {
            Box::pin(async move {
                calls.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(delay).await;
                (V(value), ttl)
            })
        }
    }

    #[tokio::test]
    async fn hit_after_miss_then_expiry_reloads() {
        let cache = SingleFlight::<V>::new(16, 1 << 20);
        let calls = Arc::new(AtomicUsize::new(0));
        let ttl = Some(Duration::from_millis(80));

        let (v, l) = cache
            .get_or_load("k".into(), counting_loader(&calls, 1, ttl, Duration::ZERO))
            .await;
        assert_eq!((v, l), (V(1), Lookup::Miss));
        let (v, l) = cache
            .get_or_load("k".into(), counting_loader(&calls, 2, ttl, Duration::ZERO))
            .await;
        assert_eq!(
            (v, l),
            (V(1), Lookup::Hit),
            "second call is served from the cache"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        tokio::time::sleep(Duration::from_millis(120)).await;
        let (v, l) = cache
            .get_or_load("k".into(), counting_loader(&calls, 3, ttl, Duration::ZERO))
            .await;
        assert_eq!((v, l), (V(3), Lookup::Miss), "an expired entry reloads");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn concurrent_misses_run_the_loader_once() {
        let cache = SingleFlight::<V>::new(16, 1 << 20);
        let calls = Arc::new(AtomicUsize::new(0));
        let mut set = tokio::task::JoinSet::new();
        for _ in 0..200 {
            let cache = Arc::clone(&cache);
            let load = counting_loader(
                &calls,
                7,
                Some(Duration::from_secs(5)),
                Duration::from_millis(50),
            );
            set.spawn(async move { cache.get_or_load("hot".into(), load).await });
        }
        let (mut miss, mut coalesced, mut hit) = (0, 0, 0);
        while let Some(r) = set.join_next().await {
            let (v, l) = r.unwrap();
            assert_eq!(v, V(7));
            match l {
                Lookup::Miss => miss += 1,
                Lookup::Coalesced => coalesced += 1,
                Lookup::Hit => hit += 1,
                Lookup::Bypass(c) => panic!("no bypass expected, got {c:?}"),
            }
        }
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "N concurrent requests -> 1 loader call"
        );
        assert_eq!(miss, 1);
        assert_eq!(miss + coalesced + hit, 200);
    }

    #[tokio::test]
    async fn uncacheable_results_are_shared_in_flight_but_not_stored() {
        let cache = SingleFlight::<V>::new(16, 1 << 20);
        let calls = Arc::new(AtomicUsize::new(0));
        let mut set = tokio::task::JoinSet::new();
        for _ in 0..20 {
            let cache = Arc::clone(&cache);
            let load = counting_loader(&calls, 500, None, Duration::from_millis(50));
            set.spawn(async move { cache.get_or_load("err".into(), load).await });
        }
        while let Some(r) = set.join_next().await {
            assert_eq!(r.unwrap().0, V(500));
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(cache.len(), 0, "an uncacheable result is not stored");
        // The next request runs the loader again.
        let (v, l) = cache
            .get_or_load(
                "err".into(),
                counting_loader(&calls, 200, None, Duration::ZERO),
            )
            .await;
        assert_eq!((v, l), (V(200), Lookup::Miss));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn leader_cancellation_still_completes_the_load() {
        let cache = SingleFlight::<V>::new(16, 1 << 20);
        let calls = Arc::new(AtomicUsize::new(0));
        let load = counting_loader(
            &calls,
            9,
            Some(Duration::from_secs(5)),
            Duration::from_millis(60),
        );
        let leader = {
            let cache = Arc::clone(&cache);
            tokio::spawn(async move { cache.get_or_load("k".into(), load).await })
        };
        tokio::time::sleep(Duration::from_millis(10)).await;
        let follower = {
            let cache = Arc::clone(&cache);
            let load = counting_loader(&calls, 0, None, Duration::ZERO);
            tokio::spawn(async move { cache.get_or_load("k".into(), load).await })
        };
        tokio::time::sleep(Duration::from_millis(10)).await;
        leader.abort(); // the client that started the load disconnects
        let (v, l) = follower.await.unwrap();
        assert_eq!((v, l), (V(9), Lookup::Coalesced));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn panicking_loader_frees_the_key() {
        let cache = SingleFlight::<V>::new(16, 1 << 20);
        let c2 = Arc::clone(&cache);
        let r = tokio::spawn(async move {
            c2.get_or_load("p".into(), || async { panic!("boom") })
                .await
        })
        .await;
        assert!(r.is_err(), "the panic propagates to the leader");
        assert_eq!(cache.len(), 0, "the in-flight slot is cleared");
        let calls = Arc::new(AtomicUsize::new(0));
        let (v, l) = cache
            .get_or_load("p".into(), counting_loader(&calls, 1, None, Duration::ZERO))
            .await;
        assert_eq!((v, l), (V(1), Lookup::Miss));
    }

    #[tokio::test]
    async fn bounded_entries_evict_the_soonest_to_expire() {
        let cache = SingleFlight::<V>::new(2, 1 << 20);
        let calls = Arc::new(AtomicUsize::new(0));
        for (k, ttl) in [("a", 1), ("b", 5), ("c", 5)] {
            cache
                .get_or_load(
                    k.into(),
                    counting_loader(&calls, 0, Some(Duration::from_secs(ttl)), Duration::ZERO),
                )
                .await;
        }
        assert_eq!(cache.len(), 2);
        let (_, l) = cache
            .get_or_load("a".into(), counting_loader(&calls, 0, None, Duration::ZERO))
            .await;
        assert_eq!(l, Lookup::Miss, "`a` (soonest to expire) was evicted");
    }

    #[tokio::test]
    async fn byte_budget_is_enforced() {
        let cache = SingleFlight::<V>::new(100, 30); // each entry weighs 8 + key len
        let calls = Arc::new(AtomicUsize::new(0));
        for k in ["k1", "k2", "k3", "k4", "k5"] {
            cache
                .get_or_load(
                    k.into(),
                    counting_loader(&calls, 0, Some(Duration::from_secs(5)), Duration::ZERO),
                )
                .await;
        }
        assert!(cache.lock().bytes <= 30);
        assert_eq!(cache.len(), 3);
    }

    // ── policy / key / TTL rules ──

    #[test]
    fn key_normalises_param_order_and_bypasses_junk() {
        let p = policy_for("/v1/audit").unwrap();
        let a = cache_key("/v1/audit", Some("limit=60&exclude_pegged=false"), p).unwrap();
        let b = cache_key("/v1/audit", Some("exclude_pegged=false&limit=60"), p).unwrap();
        assert_eq!(a, b);
        let c = cache_key("/v1/audit", Some("exclude_pegged=false&limit=61"), p).unwrap();
        assert_ne!(a, c);
        assert_eq!(
            cache_key("/v1/audit", Some("limit=60&x=1"), p),
            Err(BypassReason::UnknownParam)
        );
        assert_eq!(
            cache_key("/v1/audit", Some("limit=1&limit=2"), p),
            Err(BypassReason::RepeatedParam)
        );
        // The path, not the template, is the key: symbols never collide.
        let s = policy_for("/v1/assets/:symbol").unwrap();
        assert_ne!(
            cache_key("/v1/assets/USDC", None, s).unwrap(),
            cache_key("/v1/assets/USDe", None, s).unwrap()
        );
        assert_eq!(
            cache_key("/v1/assets/USDC", Some("x=1"), s),
            Err(BypassReason::UnknownParam)
        );
    }

    #[test]
    fn key_is_unambiguous_for_values_with_separator_bytes() {
        let p = policy_for("/v1/audit").unwrap();
        let smuggled = cache_key("/v1/audit", Some("asset=jitoSOL%00limit%3D1"), p).unwrap();
        let real = cache_key("/v1/audit", Some("asset=jitoSOL&limit=1"), p).unwrap();
        assert_ne!(
            smuggled, real,
            "a decoded NUL/= must not forge a pair boundary"
        );
        let amp = cache_key("/v1/audit", Some("asset=a%26limit%3D1"), p).unwrap();
        assert_ne!(
            amp,
            cache_key("/v1/audit", Some("asset=a&limit=1"), p).unwrap()
        );
    }

    #[tokio::test]
    async fn slow_leader_waiters_time_out_and_run_their_own_load() {
        let cache = SingleFlight::<V>::with_wait_timeout(16, 1 << 20, Duration::from_millis(50));
        let calls = Arc::new(AtomicUsize::new(0));
        let slow = counting_loader(
            &calls,
            1,
            Some(Duration::from_secs(5)),
            Duration::from_millis(400),
        );
        let leader = {
            let cache = Arc::clone(&cache);
            tokio::spawn(async move { cache.get_or_load("k".into(), slow).await })
        };
        tokio::time::sleep(Duration::from_millis(10)).await;
        let started = Instant::now();
        let (v, l) = cache
            .get_or_load(
                "k".into(),
                counting_loader(&calls, 2, Some(Duration::from_secs(5)), Duration::ZERO),
            )
            .await;
        assert_eq!((v, l), (V(2), Lookup::Bypass(BypassCause::WaitTimeout)));
        assert!(
            started.elapsed() < Duration::from_millis(300),
            "the waiter did not wait for the slow leader"
        );
        // The waiter's own result was not stored; the leader's is.
        let (v, l) = leader.await.unwrap();
        assert_eq!((v, l), (V(1), Lookup::Miss));
        let (v, l) = cache
            .get_or_load("k".into(), counting_loader(&calls, 3, None, Duration::ZERO))
            .await;
        assert_eq!((v, l), (V(1), Lookup::Hit));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn ttl_respects_status_and_cache_control() {
        let route = Duration::from_secs(5);
        let mut h = HeaderMap::new();
        assert_eq!(storable_ttl(StatusCode::OK, &h, 10, route), Some(route));
        for status in [
            StatusCode::NOT_FOUND,
            StatusCode::BAD_REQUEST,
            StatusCode::INTERNAL_SERVER_ERROR,
            StatusCode::SERVICE_UNAVAILABLE,
            StatusCode::NOT_MODIFIED,
        ] {
            assert_eq!(
                storable_ttl(status, &h, 10, route),
                None,
                "{status} is never stored"
            );
        }
        h.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=3, stale-while-revalidate=10"),
        );
        assert_eq!(
            storable_ttl(StatusCode::OK, &h, 10, route),
            Some(Duration::from_secs(3))
        );
        h.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=60"),
        );
        assert_eq!(storable_ttl(StatusCode::OK, &h, 10, route), Some(route));
        for cc in ["no-store", "no-cache", "private, max-age=5", "max-age=0"] {
            h.insert(header::CACHE_CONTROL, HeaderValue::from_static(cc));
            assert_eq!(storable_ttl(StatusCode::OK, &h, 10, route), None, "{cc}");
        }
        h.remove(header::CACHE_CONTROL);
        assert_eq!(
            storable_ttl(StatusCode::OK, &h, MAX_ENTRY_BYTES + 1, route),
            None
        );
    }

    /// Every policy names a route that main.rs actually registers, so a route
    /// rename cannot silently turn caching off.
    #[test]
    fn every_policy_route_is_registered() {
        let main = include_str!("main.rs");
        for p in POLICIES {
            assert!(
                main.contains(&format!("\"{}\"", p.route)),
                "{} is not a registered route",
                p.route
            );
        }
    }

    /// The param allowlists match the handlers' query structs, so a new query
    /// parameter is not silently bypassed (or worse, silently ignored).
    #[test]
    fn param_allowlists_match_the_query_structs() {
        use utoipa::IntoParams;
        fn names<T: IntoParams>() -> Vec<String> {
            let mut v: Vec<String> = T::into_params(|| None)
                .into_iter()
                .map(|p| p.name)
                .collect();
            v.sort();
            v
        }
        fn allow(route: &str) -> Vec<String> {
            let mut v: Vec<String> = policy_for(route)
                .unwrap()
                .params
                .iter()
                .map(|s| s.to_string())
                .collect();
            v.sort();
            v
        }
        assert_eq!(
            allow("/v1/assets"),
            names::<crate::routes::assets::ListQuery>()
        );
        assert_eq!(
            allow("/v1/audit"),
            names::<crate::routes::audit::IndexParams>()
        );
        assert_eq!(
            allow("/v1/assets/:symbol/simulate-depeg"),
            names::<crate::routes::assets::SimulateDepegQuery>()
        );
    }

    // ── e2e: the real middleware stack (rate limiter outside, cache inside) ──

    fn e2e_app(calls: Arc<AtomicUsize>, limit: u32) -> axum::Router {
        use axum::routing::get;
        let c1 = Arc::clone(&calls);
        let c2 = Arc::clone(&calls);
        let c3 = Arc::clone(&calls);
        let limits = crate::rate_limit::RateLimits {
            main: crate::rate_limit::RateLimiter::new(limit),
            csv: crate::rate_limit::RateLimiter::new(10),
            ssr: None,
        };
        axum::Router::new()
            // A policy route returning 200 with a body that changes per run.
            .route(
                "/v1/stats",
                get(move || {
                    let c = Arc::clone(&c1);
                    async move {
                        let n = c.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(30)).await;
                        (
                            [(header::CACHE_CONTROL, "public, max-age=10")],
                            axum::Json(serde_json::json!({"run": n})),
                        )
                    }
                }),
            )
            // A policy route that always errors.
            .route(
                "/v1/assets/:symbol",
                get(move || {
                    let c = Arc::clone(&c2);
                    async move {
                        c.fetch_add(1, Ordering::SeqCst);
                        crate::error::ApiError::unknown_asset("nope")
                    }
                }),
            )
            // A policy route with validators, like /v1/peg/feed.
            .route(
                "/v1/peg/feed",
                get(move || {
                    let c = Arc::clone(&c3);
                    async move {
                        c.fetch_add(1, Ordering::SeqCst);
                        (
                            [
                                (header::ETAG, "W/\"abc\""),
                                (header::CACHE_CONTROL, "public, max-age=5"),
                                (header::CONTENT_TYPE, "application/json"),
                            ],
                            "{\"ok\":true}",
                        )
                    }
                }),
            )
            .layer(axum::middleware::from_fn_with_state(
                new_response_cache(),
                middleware,
            ))
            .layer(axum::middleware::from_fn_with_state(
                limits,
                crate::rate_limit::middleware,
            ))
    }

    fn get_req(uri: &str, ip: &str) -> axum::http::Request<Body> {
        use axum::extract::connect_info::ConnectInfo;
        let mut req = axum::http::Request::builder()
            .uri(uri)
            .body(Body::empty())
            .unwrap();
        req.extensions_mut()
            .insert(ConnectInfo(ip.parse::<std::net::SocketAddr>().unwrap()));
        req
    }

    async fn body_of(resp: Response) -> Bytes {
        axum::body::to_bytes(resp.into_body(), 1 << 20)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn e2e_hit_is_byte_identical_and_rate_headers_stay_per_request() {
        use tower::ServiceExt;
        let calls = Arc::new(AtomicUsize::new(0));
        let app = e2e_app(Arc::clone(&calls), 100);

        let first = app
            .clone()
            .oneshot(get_req("/v1/stats", "203.0.113.1:1"))
            .await
            .unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        let rem1 = first.headers()["ratelimit-remaining"].clone();
        assert!(
            first.headers().get(header::AGE).is_none(),
            "a miss carries no Age"
        );
        let cc1 = first.headers()[header::CACHE_CONTROL].clone();
        let b1 = body_of(first).await;

        let second = app
            .clone()
            .oneshot(get_req("/v1/stats", "203.0.113.1:1"))
            .await
            .unwrap();
        assert_eq!(second.status(), StatusCode::OK);
        assert!(
            second.headers().get(header::AGE).is_some(),
            "a hit carries Age"
        );
        assert_eq!(
            second.headers()[header::CACHE_CONTROL],
            cc1,
            "headers preserved"
        );
        let rem2 = second.headers()["ratelimit-remaining"].clone();
        assert_ne!(
            rem1, rem2,
            "the rate-limit budget is computed per request, not cached"
        );
        assert_eq!(body_of(second).await, b1, "the body is byte-identical");

        // A different IP gets its own fresh budget on the same cached body.
        let other = app
            .clone()
            .oneshot(get_req("/v1/stats", "198.51.100.2:1"))
            .await
            .unwrap();
        assert_eq!(other.headers()["ratelimit-remaining"], "99");
        assert_eq!(body_of(other).await, b1);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "one handler run served all three"
        );
    }

    #[tokio::test]
    async fn e2e_concurrent_requests_coalesce_and_rate_limit_still_applies() {
        use tower::ServiceExt;
        let calls = Arc::new(AtomicUsize::new(0));
        let app = e2e_app(Arc::clone(&calls), 50);
        let mut set = tokio::task::JoinSet::new();
        for i in 0..100 {
            let app = app.clone();
            set.spawn(async move {
                // 2 IPs x 50 requests: each IP spends exactly its budget.
                let ip = if i % 2 == 0 {
                    "192.0.2.1:1"
                } else {
                    "192.0.2.2:1"
                };
                app.oneshot(get_req("/v1/stats", ip))
                    .await
                    .unwrap()
                    .status()
            });
        }
        let mut ok = 0;
        while let Some(s) = set.join_next().await {
            if s.unwrap() == StatusCode::OK {
                ok += 1;
            }
        }
        assert_eq!(ok, 100);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "100 concurrent requests -> 1 handler run"
        );
        // The 51st request from one IP is still a 429: the cache never skips the limiter.
        let resp = app
            .oneshot(get_req("/v1/stats", "192.0.2.1:1"))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn e2e_errors_and_junk_params_are_not_cached() {
        use tower::ServiceExt;
        let calls = Arc::new(AtomicUsize::new(0));
        let app = e2e_app(Arc::clone(&calls), 100);
        for _ in 0..3 {
            let r = app
                .clone()
                .oneshot(get_req("/v1/assets/XYZ", "203.0.113.5:1"))
                .await
                .unwrap();
            assert_eq!(r.status(), StatusCode::NOT_FOUND);
            assert!(r.headers().get(header::AGE).is_none());
        }
        assert_eq!(
            calls.load(Ordering::SeqCst),
            3,
            "every 404 re-ran the handler"
        );

        let calls = Arc::new(AtomicUsize::new(0));
        let app = e2e_app(Arc::clone(&calls), 100);
        for i in 0..3 {
            let uri = format!("/v1/stats?junk={i}");
            let r = app
                .clone()
                .oneshot(get_req(&uri, "203.0.113.6:1"))
                .await
                .unwrap();
            assert_eq!(r.status(), StatusCode::OK);
        }
        assert_eq!(
            calls.load(Ordering::SeqCst),
            3,
            "unknown params bypass the cache"
        );
    }

    #[tokio::test]
    async fn e2e_conditional_get_is_answered_from_the_cached_200() {
        use tower::ServiceExt;
        let calls = Arc::new(AtomicUsize::new(0));
        let app = e2e_app(Arc::clone(&calls), 100);
        let mut req = get_req("/v1/peg/feed", "203.0.113.7:1");
        req.headers_mut()
            .insert(header::IF_NONE_MATCH, HeaderValue::from_static("W/\"abc\""));
        let r = app.clone().oneshot(req).await.unwrap();
        assert_eq!(r.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(r.headers()[header::ETAG], "W/\"abc\"");
        assert!(r.headers().get(header::CONTENT_TYPE).is_none());
        assert!(body_of(r).await.is_empty());

        // An unconditional request right after gets the full 200 from the cache,
        // never the 304 the first caller got.
        let r = app
            .clone()
            .oneshot(get_req("/v1/peg/feed", "203.0.113.7:1"))
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(body_of(r).await, Bytes::from_static(b"{\"ok\":true}"));

        let mut req = get_req("/v1/peg/feed", "203.0.113.7:1");
        req.headers_mut().insert(
            header::IF_NONE_MATCH,
            HeaderValue::from_static("W/\"other\""),
        );
        assert_eq!(
            app.clone().oneshot(req).await.unwrap().status(),
            StatusCode::OK
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}
