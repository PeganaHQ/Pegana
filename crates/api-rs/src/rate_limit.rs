//! In-memory per-IP rate limiter (sliding-window counter).
//!
//! v1: single VPS, ~5 req/s peak; a `Mutex<HashMap>` is fine. The critical
//! section is a single hashmap lookup + counter bump; lock contention at
//! expected QPS is negligible.
//!
//! Sliding-window COUNTER (not a plain fixed window): the estimate weights the
//! PREVIOUS 60s window by the fraction of it still inside the trailing 60s and
//! adds the current window's count. This closes the ~2× burst a fixed window
//! allows at the boundary (spend the full limit just before the reset, then the
//! full limit again right after). Budget refills continuously as the previous
//! window ages out, not in a single step.
//!
//! v1.5 will switch to a Redis token bucket once horizontal scaling matters.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::{
    extract::{ConnectInfo, Request, State},
    http::{header, HeaderName, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Test helper header name (the production lookup lives in `client_ip`).
#[cfg(test)]
const FORWARDED_FOR: &str = "x-forwarded-for";

/// Upper bound on tracked client buckets per limiter.
const MAX_BUCKETS: usize = 1_000_000;

/// Minimum spacing between full-map prunes under memory pressure.
const PRUNE_EVERY: Duration = Duration::from_secs(5);

const WINDOW: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct RateLimiter {
    inner: Arc<Mutex<HashMap<IpAddr, Bucket>>>,
    limit: u32,
    /// When the full-map prune last ran (it is O(n), so it is rate limited).
    last_prune: Arc<Mutex<Option<Instant>>>,
}

struct Bucket {
    /// Requests counted in the CURRENT fixed window.
    count: u32,
    /// Requests counted in the immediately PREVIOUS window; weighted into the
    /// sliding estimate by how much of it is still within the trailing WINDOW.
    prev_count: u32,
    window_start: Instant,
}

/// Snapshot of a rate-limit decision; carries the counters needed to emit the
/// `RateLimit-*` response headers so a client sees its remaining budget BEFORE
/// it hits a 429 (a DX gap vs. the partner API).
struct RateOutcome {
    allowed: bool,
    limit: u32,
    remaining: u32,
    /// Seconds until the current window rolls (a safe reset hint).
    reset: u64,
}

impl RateLimiter {
    pub fn new(per_minute: u32) -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            limit: per_minute,
            last_prune: Arc::new(Mutex::new(None)),
        }
    }

    /// Dedicated routes can share the sliding-window implementation without
    /// applying the REST middleware to a WebSocket upgrade response.
    pub fn allow(&self, ip: IpAddr) -> bool {
        self.check_metered(ip).allowed
    }

    /// Boolean fast-path used by the unit tests (prod calls `check_metered`).
    #[cfg(test)]
    fn check(&self, ip: IpAddr) -> bool {
        self.check_metered(ip).allowed
    }

    /// Metered check: rolls the window, decides allow/deny, AND returns the
    /// counters (`limit`/`remaining`/`reset`) for the `RateLimit-*` headers.
    fn check_metered(&self, ip: IpAddr) -> RateOutcome {
        let mut map = self.inner.lock().expect("rate limiter poisoned");
        let now = Instant::now();
        if map.len() >= MAX_BUCKETS && !map.contains_key(&ip) {
            // Memory bound: at most once every PRUNE_EVERY, drop buckets idle
            // for two windows; if the map is still full of live buckets, refuse
            // the new key (fail closed) and count it.
            let mut last = self.last_prune.lock().unwrap_or_else(|e| e.into_inner());
            if last.is_none_or(|t| now.duration_since(t) >= PRUNE_EVERY) {
                map.retain(|_, b| now.duration_since(b.window_start) < WINDOW * 2);
                *last = Some(now);
            }
            if map.len() >= MAX_BUCKETS {
                metrics::counter!("pegana_api_rate_limit_map_full_total").increment(1);
                return RateOutcome {
                    allowed: false,
                    limit: self.limit,
                    remaining: 0,
                    reset: WINDOW.as_secs(),
                };
            }
        }
        let bucket = map.entry(ip).or_insert(Bucket {
            count: 0,
            prev_count: 0,
            window_start: now,
        });
        // Roll the fixed window(s) forward. Exactly one elapsed window becomes
        // `prev` (still weighted in as it ages out); two or more elapsed means
        // there is no recent history to carry, so `prev` resets to 0.
        let elapsed = now.duration_since(bucket.window_start);
        if elapsed >= WINDOW {
            bucket.prev_count = if elapsed < WINDOW * 2 {
                bucket.count
            } else {
                0
            };
            bucket.count = 0;
            bucket.window_start = now;
        }
        // Sliding-window-counter estimate: the previous window weighted by the
        // fraction of it still inside the trailing WINDOW, plus this window's
        // count and the request under check. Rejected requests do NOT count
        // (else a spammer would stay blocked indefinitely).
        let in_window = now.duration_since(bucket.window_start);
        let frac = in_window.as_secs_f64() / WINDOW.as_secs_f64();
        let estimated = bucket.prev_count as f64 * (1.0 - frac) + bucket.count as f64 + 1.0;
        // Seconds until the current fixed window rolls — a safe reset hint.
        let reset = (WINDOW.as_secs_f64() - in_window.as_secs_f64())
            .max(0.0)
            .ceil() as u64;
        if estimated > self.limit as f64 {
            return RateOutcome {
                allowed: false,
                limit: self.limit,
                remaining: 0,
                reset,
            };
        }
        bucket.count += 1;
        let remaining = (self.limit as f64 - estimated).max(0.0).floor() as u32;
        RateOutcome {
            allowed: true,
            limit: self.limit,
            remaining,
            reset,
        }
    }
}

/// Insert the IETF standards-track `RateLimit-*` headers plus the legacy
/// `X-RateLimit-*` mirror (GitHub-style) so both new and old clients can read
/// the budget. Applied on EVERY response, not just 429s.
fn apply_rate_headers(resp: &mut Response, o: &RateOutcome) {
    let mut put = |name: &'static str, val: u64| {
        if let Ok(v) = HeaderValue::from_str(&val.to_string()) {
            resp.headers_mut().insert(HeaderName::from_static(name), v);
        }
    };
    put("ratelimit-limit", o.limit as u64);
    put("ratelimit-remaining", o.remaining as u64);
    put("ratelimit-reset", o.reset);
    put("x-ratelimit-limit", o.limit as u64);
    put("x-ratelimit-remaining", o.remaining as u64);
    put("x-ratelimit-reset", o.reset);
}

/// Client bucket for a request: see `client_ip` (trusted-proxy XFF, IPv6 /64).
fn client_ip(req: &Request, conn: SocketAddr) -> IpAddr {
    crate::client_ip::resolve(req.headers(), conn)
}

/// Per-route rate limit bundle. ADR-0014 mandates `/v1/audit.csv` at
/// 10/min per IP, distinct from the global limit (60/min by default). Both
/// share the same per-IP bucket model; the CSV request must satisfy BOTH
/// the stricter csv limit AND the global limit to pass.
#[derive(Clone)]
pub struct RateLimits {
    /// Global limit applied to every non-exempt request.
    pub main: RateLimiter,
    /// Stricter cap exclusive to `/v1/audit.csv` per ADR-0014. Independent
    /// per-IP bucket; does not consume the main budget when it rejects.
    pub csv: RateLimiter,
    /// Cheap dedicated readiness budget; health checks remain independent of
    /// the public REST budget.
    pub ready: RateLimiter,
    /// Authenticated budget for the web app's server-side fetches. `None`
    /// (no `PEGANA_WEB_SSR_TOKEN`) disables it.
    pub ssr: Option<SsrBypass>,
}

/// Request header carrying the web server's shared secret.
pub const SSR_TOKEN_HEADER: &str = "x-pegana-ssr-token";

/// Request header the web server uses to declare which budget a read belongs to
/// (`embed` or `page`). Honoured ONLY together with a valid SSR token; an
/// unknown or missing value means `page`.
pub const SSR_CLASS_HEADER: &str = "x-pegana-ssr-class";

/// Shortest token accepted. A short secret is guessable; refusing it keeps a
/// typo'd env value from opening an easy bypass.
pub const SSR_TOKEN_MIN_LEN: usize = 32;

/// The web app's server-side rendering (RSC, route handlers, OG images, the
/// sitemap) leaves Vercel from a small shared egress pool, so all of it shared
/// one public 60/min per-IP bucket: a crawler walking the sitemap exhausted it
/// and the 429 surfaced as 500 pages. A request carrying the shared secret in
/// [`SSR_TOKEN_HEADER`] is metered against this separate, larger budget (one
/// bucket for the whole web tier) instead of the public per-IP one. A wrong or
/// absent token is an ordinary public request; nothing tells the caller why.
#[derive(Clone)]
pub struct SsrBypass {
    token: Arc<[u8]>,
    /// Budget for ordinary page rendering (the default class).
    limiter: RateLimiter,
    /// Reserved budget for the `embed` class, independent of `limiter`.
    embed_limiter: RateLimiter,
}

impl SsrBypass {
    /// `None` when the token is unset, blank or shorter than
    /// [`SSR_TOKEN_MIN_LEN`] (logged at warn, so a bad deploy is visible).
    pub fn from_config(
        token: Option<&str>,
        per_minute: u32,
        embed_per_minute: u32,
    ) -> Option<Self> {
        let token = token.map(str::trim).filter(|t| !t.is_empty())?;
        if token.len() < SSR_TOKEN_MIN_LEN {
            tracing::warn!(
                min_len = SSR_TOKEN_MIN_LEN,
                "PEGANA_WEB_SSR_TOKEN is too short; the web SSR budget is disabled"
            );
            return None;
        }
        Some(Self {
            token: Arc::from(token.as_bytes()),
            limiter: RateLimiter::new(per_minute),
            embed_limiter: RateLimiter::new(embed_per_minute),
        })
    }

    /// Constant-time comparison (length aside), so the token cannot be
    /// recovered byte by byte from response timing.
    fn matches(&self, presented: &[u8]) -> bool {
        if presented.len() != self.token.len() {
            return false;
        }
        presented
            .iter()
            .zip(self.token.iter())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
    }

    /// Limiter for a request's declared class. Anything other than `embed`
    /// (including a missing or unknown value) uses the page budget.
    fn limiter_for(&self, class: Option<&[u8]>) -> &RateLimiter {
        match class {
            Some(b"embed") => &self.embed_limiter,
            _ => &self.limiter,
        }
    }

    /// The single bucket key for the web tier (the budget is per secret, not
    /// per egress IP).
    const KEY: IpAddr = IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED);
}

/// Log the first 429 for a client within each window at WARN (so an abusive
/// source is identifiable), without turning a flood into a log flood.
fn warn_first_rate_limited(ip: IpAddr, route: &'static str) {
    use std::sync::OnceLock;
    static SEEN: OnceLock<Mutex<HashMap<(IpAddr, &'static str), Instant>>> = OnceLock::new();
    let seen = SEEN.get_or_init(|| Mutex::new(HashMap::new()));
    let now = Instant::now();
    let mut map = seen.lock().unwrap_or_else(|e| e.into_inner());
    if map.len() > 10_000 {
        map.retain(|_, t| now.duration_since(*t) < WINDOW);
    }
    let first = map
        .get(&(ip, route))
        .map(|t| now.duration_since(*t) >= WINDOW)
        .unwrap_or(true);
    if first && map.len() <= 10_000 {
        map.insert((ip, route), now);
        tracing::warn!(client = %ip, route, "rate limited");
    }
}

/// 429 response carrying the JSON error envelope (same `{error, message}` shape
/// as `ApiError`) plus a `Retry-After` header. The bare `StatusCode` this used
/// to return had an EMPTY body and no `Retry-After`: a client that `.json()`s
/// every response broke on it, and nothing told it when to retry (deep-audit
/// follow-up to the Gecko API report, 2026-06-10).
fn too_many_requests() -> Response {
    (
        StatusCode::TOO_MANY_REQUESTS,
        // The window is 60s; advertise it as a safe upper bound for back-off.
        [(header::RETRY_AFTER, "60")],
        Json(json!({
            "error": "rate_limited",
            "message": "rate limit exceeded; retry after the window resets (see Retry-After)",
        })),
    )
        .into_response()
}

/// Skip /healthz; meter /readyz with its own budget.
/// ADR-0014: `/v1/audit.csv` checked against the stricter csv limiter
/// BEFORE the global one (and only consumes the global budget if the csv
/// check passes).
pub async fn middleware(
    State(limits): State<RateLimits>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path();
    if path == "/healthz" {
        return next.run(req).await;
    }
    if path == "/readyz" {
        let ready_ip = client_ip(&req, addr);
        let outcome = limits.ready.check_metered(ready_ip);
        if !outcome.allowed {
            metrics::counter!("pegana_api_rate_limited_total", "route" => "readyz").increment(1);
            warn_first_rate_limited(ready_ip, "readyz");
            let mut resp = too_many_requests();
            apply_rate_headers(&mut resp, &outcome);
            return resp;
        }
        let mut resp = next.run(req).await;
        apply_rate_headers(&mut resp, &outcome);
        return resp;
    }
    // Web SSR budget: an authenticated web-server request never touches the
    // public per-IP buckets (see `SsrBypass`).
    if let Some(ssr) = limits.ssr.as_ref() {
        let presented = req
            .headers()
            .get(SSR_TOKEN_HEADER)
            .map(|v| v.as_bytes())
            .filter(|v| ssr.matches(v));
        if presented.is_some() {
            let class = req.headers().get(SSR_CLASS_HEADER).map(|v| v.as_bytes());
            let outcome = ssr.limiter_for(class).check_metered(SsrBypass::KEY);
            if !outcome.allowed {
                metrics::counter!("pegana_api_rate_limited_total", "route" => "web_ssr")
                    .increment(1);
                warn_first_rate_limited(SsrBypass::KEY, "web_ssr");
                let mut resp = too_many_requests();
                apply_rate_headers(&mut resp, &outcome);
                return resp;
            }
            metrics::counter!("pegana_api_web_ssr_requests_total").increment(1);
            let mut resp = next.run(req).await;
            apply_rate_headers(&mut resp, &outcome);
            return resp;
        }
    }

    let ip = client_ip(&req, addr);

    // ADR-0014: per-route 10/min on CSV export.
    if path == "/v1/audit.csv" {
        let csv = limits.csv.check_metered(ip);
        if !csv.allowed {
            metrics::counter!("pegana_api_rate_limited_total", "route" => "audit.csv").increment(1);
            warn_first_rate_limited(ip, "audit.csv");
            let mut resp = too_many_requests();
            apply_rate_headers(&mut resp, &csv);
            return resp;
        }
    }

    // Global limit applies to everything. Its counters drive the headers.
    let outcome = limits.main.check_metered(ip);
    if !outcome.allowed {
        metrics::counter!("pegana_api_rate_limited_total", "route" => "global").increment(1);
        warn_first_rate_limited(ip, "global");
        let mut resp = too_many_requests();
        apply_rate_headers(&mut resp, &outcome);
        return resp;
    }
    let mut resp = next.run(req).await;
    apply_rate_headers(&mut resp, &outcome);
    resp
}

/// Prune buckets older than 2× window. Bounded memory under NAT/exit-pool churn.
pub fn spawn_janitor(limiter: RateLimiter) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(300));
        tick.tick().await;
        loop {
            tick.tick().await;
            let mut map = limiter.inner.lock().expect("rate limiter poisoned");
            let now = Instant::now();
            map.retain(|_, b| now.duration_since(b.window_start) < WINDOW * 2);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request as HttpRequest;
    use std::net::{Ipv4Addr, SocketAddr};

    fn req_with_xff(xff: Option<&str>) -> HttpRequest<Body> {
        let mut b = HttpRequest::builder().uri("/v1/assets");
        if let Some(v) = xff {
            b = b.header(FORWARDED_FOR, v);
        }
        b.body(Body::empty()).unwrap()
    }

    #[test]
    fn client_ip_prefers_xff() {
        let r = req_with_xff(Some("203.0.113.7, 10.0.0.1"));
        let conn: SocketAddr = "127.0.0.1:9999".parse().unwrap();
        assert_eq!(
            client_ip(&r, conn),
            IpAddr::V4(Ipv4Addr::new(203, 0, 113, 7))
        );
    }

    #[test]
    fn client_ip_falls_back_to_connect_info() {
        let r = req_with_xff(None);
        let conn: SocketAddr = "127.0.0.1:9999".parse().unwrap();
        assert_eq!(client_ip(&r, conn), IpAddr::V4(Ipv4Addr::LOCALHOST));
    }

    #[test]
    fn client_ip_ignores_garbage_xff() {
        let r = req_with_xff(Some("not-an-ip"));
        let conn: SocketAddr = "127.0.0.1:9999".parse().unwrap();
        assert_eq!(client_ip(&r, conn), IpAddr::V4(Ipv4Addr::LOCALHOST));
    }

    #[test]
    fn under_limit_passes() {
        let l = RateLimiter::new(5);
        let ip: IpAddr = Ipv4Addr::LOCALHOST.into();
        for _ in 0..5 {
            assert!(l.check(ip));
        }
    }

    #[test]
    fn over_limit_rejects() {
        let l = RateLimiter::new(3);
        let ip: IpAddr = Ipv4Addr::LOCALHOST.into();
        for _ in 0..3 {
            assert!(l.check(ip), "first {} within limit", 3);
        }
        assert!(!l.check(ip), "fourth request should be denied");
        assert!(!l.check(ip), "subsequent requests stay denied");
    }

    #[test]
    fn different_ips_have_independent_buckets() {
        let l = RateLimiter::new(2);
        let a: IpAddr = Ipv4Addr::new(10, 0, 0, 1).into();
        let b: IpAddr = Ipv4Addr::new(10, 0, 0, 2).into();
        assert!(l.check(a));
        assert!(l.check(a));
        assert!(!l.check(a), "a exhausted its budget");
        // b shares the limiter but its own bucket.
        assert!(l.check(b));
        assert!(l.check(b));
        assert!(!l.check(b));
    }

    #[test]
    fn sliding_window_prevents_boundary_burst() {
        // Spend the full limit in one window, then advance EXACTLY one window.
        // A plain fixed window would now allow another full `limit` (the 2× burst
        // at the boundary); the sliding counter must not, because the just-ended
        // window is still fully weighted right after the roll.
        let l = RateLimiter::new(2);
        let ip: IpAddr = Ipv4Addr::LOCALHOST.into();
        assert!(l.check(ip));
        assert!(l.check(ip));
        assert!(!l.check(ip));
        {
            let mut map = l.inner.lock().unwrap();
            let b = map.get_mut(&ip).unwrap();
            b.window_start = Instant::now() - Duration::from_secs(60);
        }
        assert!(
            !l.check(ip),
            "no 2× burst: the just-ended window still counts at the boundary"
        );
    }

    #[test]
    fn budget_fully_refills_after_two_idle_windows() {
        // Sliding refill is gradual (the previous window ages out over WINDOW),
        // so full budget returns only after TWO idle windows leave no recent
        // history. Rewind window_start to simulate that without sleeping.
        let l = RateLimiter::new(2);
        let ip: IpAddr = Ipv4Addr::LOCALHOST.into();
        assert!(l.check(ip));
        assert!(l.check(ip));
        assert!(!l.check(ip));
        {
            let mut map = l.inner.lock().unwrap();
            let b = map.get_mut(&ip).unwrap();
            b.window_start = Instant::now() - Duration::from_secs(121);
        }
        assert!(
            l.check(ip),
            "after two idle windows the previous count fully ages out"
        );
    }

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn ssr_bypass_requires_a_long_enough_token() {
        assert!(SsrBypass::from_config(None, 10, 10).is_none());
        assert!(SsrBypass::from_config(Some("   "), 10, 10).is_none());
        assert!(SsrBypass::from_config(Some("short-secret"), 10, 10).is_none());
        let b = SsrBypass::from_config(Some(TOKEN), 10, 10).expect("32-char token enables it");
        assert!(b.matches(TOKEN.as_bytes()));
        assert!(!b.matches(b"0123456789abcdef0123456789abcdeX"));
        assert!(!b.matches(b"0123456789abcdef"));
        assert!(!b.matches(b""));
    }

    /// With the token, the web tier is metered on its own budget: the public
    /// per-IP bucket of the shared egress IP is not consumed, and requests keep
    /// passing after that bucket would be exhausted. A wrong token is a normal
    /// public request.
    #[tokio::test]
    async fn ssr_token_uses_its_own_budget() {
        use axum::extract::connect_info::ConnectInfo;
        use axum::routing::get;
        use axum::Router;
        use tower::ServiceExt;

        let limits = RateLimits {
            ready: RateLimiter::new(30),
            main: RateLimiter::new(2),
            csv: RateLimiter::new(10),
            ssr: SsrBypass::from_config(Some(TOKEN), 5, 5),
        };
        let app = Router::new()
            .route("/v1/assets", get(|| async { "ok" }))
            .layer(axum::middleware::from_fn_with_state(limits, middleware));
        let egress: SocketAddr = "198.51.100.20:443".parse().unwrap();
        let mk = |token: Option<&str>| {
            let mut b = HttpRequest::builder().uri("/v1/assets");
            if let Some(t) = token {
                b = b.header(SSR_TOKEN_HEADER, t);
            }
            let mut req = b.body(Body::empty()).unwrap();
            req.extensions_mut().insert(ConnectInfo(egress));
            req
        };
        // 5 authenticated requests pass even though the public limit is 2.
        for i in 0..5 {
            let r = app.clone().oneshot(mk(Some(TOKEN))).await.unwrap();
            assert_eq!(r.status(), StatusCode::OK, "ssr request {i}");
            assert_eq!(
                r.headers()
                    .get("ratelimit-limit")
                    .and_then(|v| v.to_str().ok()),
                Some("5")
            );
        }
        // The 6th exceeds the web budget.
        let r = app.clone().oneshot(mk(Some(TOKEN))).await.unwrap();
        assert_eq!(r.status(), StatusCode::TOO_MANY_REQUESTS);
        // The public bucket for the same IP is untouched: 2 pass, then 429.
        for _ in 0..2 {
            let r = app.clone().oneshot(mk(None)).await.unwrap();
            assert_eq!(r.status(), StatusCode::OK);
        }
        let r = app.clone().oneshot(mk(Some("wrong-token"))).await.unwrap();
        assert_eq!(
            r.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "a wrong token is metered as public"
        );
    }

    /// The page and embed classes are metered on independent buckets, and the
    /// class header means nothing without a valid token.
    #[tokio::test]
    async fn ssr_classes_have_independent_budgets() {
        use axum::extract::connect_info::ConnectInfo;
        use axum::routing::get;
        use axum::Router;
        use tower::ServiceExt;

        let limits = RateLimits {
            ready: RateLimiter::new(30),
            main: RateLimiter::new(2),
            csv: RateLimiter::new(10),
            ssr: SsrBypass::from_config(Some(TOKEN), 3, 4),
        };
        let app = Router::new()
            .route("/v1/assets", get(|| async { "ok" }))
            .layer(axum::middleware::from_fn_with_state(limits, middleware));
        let egress: SocketAddr = "198.51.100.21:443".parse().unwrap();
        let mk = |token: Option<&str>, class: Option<&str>| {
            let mut b = HttpRequest::builder().uri("/v1/assets");
            if let Some(t) = token {
                b = b.header(SSR_TOKEN_HEADER, t);
            }
            if let Some(c) = class {
                b = b.header(SSR_CLASS_HEADER, c);
            }
            let mut req = b.body(Body::empty()).unwrap();
            req.extensions_mut().insert(ConnectInfo(egress));
            req
        };
        let status = |app: &Router, req: HttpRequest<Body>| {
            let app = app.clone();
            async move { app.oneshot(req).await.unwrap().status() }
        };

        // Exhaust the page budget (3), including a missing and an unknown class.
        assert_eq!(status(&app, mk(Some(TOKEN), None)).await, StatusCode::OK);
        assert_eq!(
            status(&app, mk(Some(TOKEN), Some("page"))).await,
            StatusCode::OK
        );
        assert_eq!(
            status(&app, mk(Some(TOKEN), Some("bogus"))).await,
            StatusCode::OK
        );
        assert_eq!(
            status(&app, mk(Some(TOKEN), None)).await,
            StatusCode::TOO_MANY_REQUESTS
        );
        // Embed is unaffected: its own 4 requests still pass, then it is limited.
        for i in 0..4 {
            assert_eq!(
                status(&app, mk(Some(TOKEN), Some("embed"))).await,
                StatusCode::OK,
                "embed request {i}"
            );
        }
        assert_eq!(
            status(&app, mk(Some(TOKEN), Some("embed"))).await,
            StatusCode::TOO_MANY_REQUESTS
        );
        // And page stays exhausted independently of embed.
        assert_eq!(
            status(&app, mk(Some(TOKEN), Some("page"))).await,
            StatusCode::TOO_MANY_REQUESTS
        );

        // Spoofing the class without a valid token does nothing: it is a public
        // request on the public per-IP bucket (2/min), not the embed budget.
        for _ in 0..2 {
            assert_eq!(status(&app, mk(None, Some("embed"))).await, StatusCode::OK);
        }
        assert_eq!(
            status(&app, mk(None, Some("embed"))).await,
            StatusCode::TOO_MANY_REQUESTS
        );
        assert_eq!(
            status(&app, mk(Some("wrong-token"), Some("embed"))).await,
            StatusCode::TOO_MANY_REQUESTS
        );
    }

    #[test]
    fn too_many_requests_is_json_with_retry_after() {
        let resp = too_many_requests();
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            resp.headers()
                .get(header::RETRY_AFTER)
                .and_then(|v| v.to_str().ok()),
            Some("60"),
            "429 must carry Retry-After so clients back off"
        );
        assert_eq!(
            resp.headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok()),
            Some("application/json"),
            "429 body must be JSON, not empty/text"
        );
    }

    #[test]
    fn metered_reports_limit_remaining_reset() {
        let l = RateLimiter::new(5);
        let ip: IpAddr = Ipv4Addr::LOCALHOST.into();
        let first = l.check_metered(ip);
        assert!(first.allowed);
        assert_eq!(first.limit, 5);
        assert_eq!(first.remaining, 4, "one request consumed of five");
        assert!(
            (59..=60).contains(&first.reset),
            "reset ~60s at window start, got {}",
            first.reset
        );
        // Consume the rest of the budget; the last allowed one reports remaining 0.
        for _ in 0..4 {
            l.check_metered(ip);
        }
        let denied = l.check_metered(ip);
        assert!(!denied.allowed, "sixth request over the limit of five");
        assert_eq!(denied.remaining, 0);
        assert_eq!(denied.limit, 5);
    }

    #[test]
    fn apply_rate_headers_sets_ietf_and_legacy_mirror() {
        let mut resp = Response::new(axum::body::Body::empty());
        apply_rate_headers(
            &mut resp,
            &RateOutcome {
                allowed: true,
                limit: 300,
                remaining: 42,
                reset: 17,
            },
        );
        let h = resp.headers();
        for (name, want) in [
            ("ratelimit-limit", "300"),
            ("ratelimit-remaining", "42"),
            ("ratelimit-reset", "17"),
            ("x-ratelimit-limit", "300"),
            ("x-ratelimit-remaining", "42"),
            ("x-ratelimit-reset", "17"),
        ] {
            assert_eq!(
                h.get(name).and_then(|v| v.to_str().ok()),
                Some(want),
                "{name} header"
            );
        }
    }
}
