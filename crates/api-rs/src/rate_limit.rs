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

/// Header set by Caddy (and most reverse proxies) carrying the original
/// client IP. We trust it unconditionally because, in production, this
/// service only listens on the docker-internal network — the sole peer
/// that can reach `api:8080` is the Caddy container.
const FORWARDED_FOR: &str = "x-forwarded-for";

const WINDOW: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct RateLimiter {
    inner: Arc<Mutex<HashMap<IpAddr, Bucket>>>,
    limit: u32,
}

struct Bucket {
    /// Requests counted in the CURRENT fixed window.
    count: u32,
    /// Requests counted in the immediately PREVIOUS window; weighted into the
    /// sliding estimate by how much of it is still within the trailing WINDOW.
    prev_count: u32,
    window_start: Instant,
}

/// Snapshot of a rate-limit decision — carries the counters needed to emit the
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
        }
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

/// Extract the originating client IP. Prefers the first entry of
/// `X-Forwarded-For` (set by Caddy) and falls back to the TCP source when
/// the header is absent — useful during local cargo-run dev where there
/// is no proxy in front.
///
/// Without this, every public request looked like it came from Caddy's
/// container IP, so the entire internet shared one rate-limit bucket.
fn client_ip(req: &Request, conn: SocketAddr) -> IpAddr {
    if let Some(raw) = req
        .headers()
        .get(FORWARDED_FOR)
        .and_then(|v| v.to_str().ok())
    {
        if let Some(first) = raw.split(',').next() {
            if let Ok(ip) = first.trim().parse::<IpAddr>() {
                return ip;
            }
        }
    }
    conn.ip()
}

/// Per-route rate limit bundle. ADR-0014 mandates `/v1/audit.csv` at
/// 10/min per IP, distinct from the global limit (typically 300/min). Both
/// share the same per-IP bucket model; the CSV request must satisfy BOTH
/// the stricter csv limit AND the global limit to pass.
#[derive(Clone)]
pub struct RateLimits {
    /// Global limit applied to every non-exempt request.
    pub main: RateLimiter,
    /// Stricter cap exclusive to `/v1/audit.csv` per ADR-0014. Independent
    /// per-IP bucket — does not consume the main budget when it rejects.
    pub csv: RateLimiter,
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
            "message": "rate limit exceeded — retry after the window resets (see Retry-After)",
        })),
    )
        .into_response()
}

/// Skip /healthz and /readyz so external monitoring can poll freely.
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
    if path == "/healthz" || path == "/readyz" {
        return next.run(req).await;
    }
    let ip = client_ip(&req, addr);

    // ADR-0014: per-route 10/min on CSV export.
    if path == "/v1/audit.csv" {
        let csv = limits.csv.check_metered(ip);
        if !csv.allowed {
            metrics::counter!("pegana_api_rate_limited_total", "route" => "audit.csv").increment(1);
            let mut resp = too_many_requests();
            apply_rate_headers(&mut resp, &csv);
            return resp;
        }
    }

    // Global limit applies to everything. Its counters drive the headers.
    let outcome = limits.main.check_metered(ip);
    if !outcome.allowed {
        metrics::counter!("pegana_api_rate_limited_total", "route" => "global").increment(1);
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
