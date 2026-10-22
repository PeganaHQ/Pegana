//! Pegana public API — REST + WebSocket.
//! Anonymous read-only surface: assets, peg feed, audit receipts, calibration,
//! methodology, stats, health, and the live `/v1/ws` stream.

mod error;
mod extract;
mod hot_cache;
mod market_score;
mod openapi;
mod oracle_degraded;
mod params;
mod rate_limit;
mod response;
mod risk_score;
mod routes;
mod schema;
mod serde_fmt;
mod ws;

use anyhow::{Context, Result};
use axum::{
    extract::{DefaultBodyLimit, Request},
    middleware::Next,
    response::Response,
    routing::get,
    Router,
};
use serde::Deserialize;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;

/// Concurrent WebSocket connections allowed from a single IP. Every socket
/// is a receiver on ONE shared Redis subscription (ws.rs `WsHub`), so the cap
/// bounds per-address fan-out cost (one fd + a broadcast receiver each), not
/// Redis clients.
///
/// 20, not 5: the web console opens one socket per (app) tab, and offices,
/// campuses and mobile CGNAT put many people behind one address, so 5 locked
/// the sixth tab behind a NAT out of live updates (429 on the handshake).
pub const WS_MAX_PER_IP: u32 = 20;

/// Server-wide WebSocket cap. Each socket costs one file descriptor; the api
/// runs with `nofile` 65536 (docker-compose ulimits, and `raise_nofile_limit`
/// at startup), so 10k sockets leave ample room for REST accepts, the Postgres
/// pool and Redis. Past the cap the handshake gets a JSON 503 + Retry-After
/// instead of the process hitting EMFILE.
pub const WS_MAX_TOTAL: usize = 10_000;

/// Hard cap on inbound request body size. The public surface is GET-only, but
/// the limit stays as a defensive default for any future write route and keeps
/// us off the 2 MB default that axum's `Json` extractor inherits.
pub const MAX_REQUEST_BODY_BYTES: usize = 64 * 1024;

#[derive(Clone)]
pub struct AppState {
    pub pg: PgPool,
    /// Cloneable Redis client (REST caches). The WebSocket stream does NOT
    /// open per-socket connections: see `ws_hub`.
    pub redis: redis::Client,
    /// Shared fan-out from the single `pegana:discount` subscription to every
    /// WebSocket (ws.rs).
    pub ws_hub: Arc<ws::WsHub>,
    pub started_at: chrono::DateTime<chrono::Utc>,
    /// Origins (Origin header values) that are allowed to open a WebSocket.
    /// Built once at startup from the same allowlist used for CORS.
    pub allowed_origins: Arc<Vec<String>>,
    /// Live WebSocket connection count per client IP. Bumped on upgrade,
    /// decremented by a RAII guard when the handle task drops.
    pub ws_per_ip: Arc<Mutex<HashMap<IpAddr, u32>>>,
    /// Launch switch (ADR-0020). While `false` the discoverable read surface
    /// of the calibration ledger; the `GET /v1/audit` INDEX and the
    /// RSS/Atom/CSV feeds built on it; returns an empty list, keeping the
    /// dogfood window quiet. Direct receipt lookups (`/v1/audit/{id}`,
    /// `/onchain`, `/replay-bundle`) stay ungated.
    pub feature_public_alerts: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    init_tracing();
    raise_nofile_limit();
    let _sentry = pegana_common::observability::init_sentry("api");
    pegana_common::observability::init_metrics("0.0.0.0:9092");

    let cfg = ApiConfig::from_env()?;
    // Pool safety net (2026-07-25 incident): sqlx's default pool is only 10
    // connections with NO statement_timeout. A single slow query pins a slot
    // for its whole duration, so one pathological query (e.g. the pre-fix
    // oracle-join seq-scan that ran 76-93s) saturates the pool and stalls
    // unrelated endpoints. Bump the ceiling and clamp per-statement runtime so
    // a regressed query fails fast with a visible error instead of hanging.
    let statement_timeout_ms = cfg.db_statement_timeout_ms;
    let pg = PgPoolOptions::new()
        .max_connections(cfg.db_max_connections)
        .after_connect(move |conn, _meta| {
            Box::pin(async move {
                if statement_timeout_ms > 0 {
                    use sqlx::Executor;
                    // SET (not SET LOCAL) persists for the pooled connection's
                    // lifetime; a bare integer is milliseconds.
                    conn.execute(
                        format!("SET statement_timeout = {statement_timeout_ms}").as_str(),
                    )
                    .await?;
                }
                Ok(())
            })
        })
        .connect(&cfg.database_url)
        .await?;
    let redis = redis::Client::open(cfg.redis_url.clone()).context("redis client open")?;

    // Origin allowlist. Previously this was `Any`, which combined with
    // localStorage-stored JWTs meant a leaked token could be replayed from
    // any origin. Extra entries can be added via CORS_EXTRA_ORIGINS
    // (comma-separated) so preview-deploy hosts (Vercel previews, ngrok
    // tunnels) don't need a code change.
    //
    // The same list gates the WebSocket Origin header — see ws::handle.
    let allowed_origin_strings = build_allowed_origins();
    let allowed_origin_headers: Vec<axum::http::HeaderValue> = allowed_origin_strings
        .iter()
        .filter_map(|s| s.parse().ok())
        .collect();

    let state = Arc::new(AppState {
        pg,
        redis,
        started_at: chrono::Utc::now(),
        allowed_origins: Arc::new(allowed_origin_strings),
        ws_per_ip: Arc::new(Mutex::new(HashMap::new())),
        ws_hub: ws::WsHub::new(ws::WS_BROADCAST_CAPACITY),
        feature_public_alerts: cfg.feature_public_alerts,
    });
    // One Redis subscriber for every WebSocket, plus the non-public symbol set
    // the stream filters on (xSOL), plus fd gauges for capacity alerting.
    // The symbol set loads (awaited) BEFORE the fan-out starts, so xSOL is
    // filtered from the first frame. If this load fails the hub withholds all
    // updates (heartbeats still flow) and the refresh task retries every 5s.
    if !ws::load_excluded(&state.pg, &state.ws_hub).await {
        tracing::warn!("ws updates withheld until the non-public symbol set loads");
    }
    ws::spawn_redis_fanout(state.redis.clone(), state.ws_hub.clone());
    ws::spawn_excluded_refresh(state.pg.clone(), state.ws_hub.clone());
    spawn_fd_gauges();
    // Parse the per-feed oracle_stale windows (assets.toml pyth_staleness
    // overrides, embedded at build time) once at startup, not on first request.
    let overrides = oracle_degraded::init_staleness_overrides();
    tracing::info!(overrides, "oracle_stale per-feed staleness windows loaded");

    // Pre-warm the /v1/assets list cache every 4s (just under its 5s TTL) so the
    // shared Redis cache never lapses cold. That endpoint's cost is a per-asset
    // 24h LATERAL aggregation over discount_1m; keeping the cache hot means real
    // dashboard loads always hit warm Redis instead of the occasional cold
    // Postgres miss (worst at low traffic, when the 5s cache expires between
    // visitors). Read-only + best-effort — a failure just logs and the next
    // user request repopulates via the handler's existing read-through.
    {
        let pg = state.pg.clone();
        let redis = state.redis.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(4));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tick.tick().await;
                if let Err(e) = routes::assets::refresh_assets_list_cache(&pg, &redis).await {
                    tracing::warn!(error = %e, "assets-list cache pre-warm failed");
                }
            }
        });
    }
    // Continuously export the /v1/calibration self-monitor as Prometheus
    // gauges so PeganaAssetMiscalibrated can page instead of relying on
    // someone polling the endpoint. Observability only — reuses the same
    // query as the handler (compute_calibration_health) and touches no
    // peg/discount/state/verdict logic. 60s cadence comfortably clears a
    // typical Prometheus scrape interval (15-30s) without hammering the
    // percentile scan every tick.
    //
    // This task is ALSO the writer for the `/v1/calibration` read-through cache
    // (see routes/calibration.rs). It already paid for the ~4.5s percentile scan
    // and previously threw the result away; persisting it on the way past is what
    // closes the unauthenticated denial-of-wallet on that endpoint, and it makes
    // the gauge and the endpoint report the SAME snapshot instead of two
    // independently-computed ones.
    {
        let pg = state.pg.clone();
        let redis = state.redis.clone();
        tokio::spawn(async move {
            // Shared with the cache TTL's compile-time guard in calibration.rs,
            // so the two can never drift into a configuration where the key
            // expires between writes.
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(
                routes::calibration::CALIBRATION_CACHE_WRITER_INTERVAL_SECS,
            ));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            // Assets whose health_code gauge we set on the previous tick. The
            // Prometheus exporter has no idle_timeout (observability.rs), and
            // compute_calibration_health filters `WHERE a.is_active`, so when an
            // asset is deactivated it drops out of the rows and its last gauge
            // value would be served forever — a frozen health_code=2 would keep
            // paging PeganaAssetMiscalibrated for a retired asset until the
            // process restarts. Each tick we reset any dropped-out asset to
            // CALIBRATION_HEALTH_INACTIVE (below the alert's `>= 2`) to close
            // that stuck-alert path.
            let mut prev_assets: std::collections::HashSet<String> =
                std::collections::HashSet::new();
            loop {
                tick.tick().await;
                let generated_at = crate::serde_fmt::rfc3339_millis_z(&chrono::Utc::now());
                let rows = match routes::calibration::compute_calibration_health(&pg).await {
                    Ok(rows) => rows,
                    Err(e) => {
                        tracing::warn!(error = %e, "calibration-health metrics export failed");
                        continue;
                    }
                };
                // Populate the endpoint's cache before consuming `rows` into the
                // gauges. Best-effort: a Redis outage just means the next request
                // recomputes — it must never drop the metrics tick.
                match redis.get_multiplexed_async_connection().await {
                    Ok(mut conn) => {
                        routes::calibration::write_calibration_cache(
                            &mut conn,
                            &rows,
                            &generated_at,
                        )
                        .await;
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "calibration cache write skipped (redis)");
                    }
                }
                let mut current: std::collections::HashSet<String> =
                    std::collections::HashSet::with_capacity(rows.len());
                for r in rows {
                    current.insert(r.symbol.clone());
                    metrics::gauge!("pegana_calibration_health_code", "asset" => r.symbol.clone())
                        .set(health_code(&r.health));
                    // Skip None so a stale/last-known gauge value never lingers
                    // for an asset whose 8d window went dark.
                    if let Some(p95) = r.p95_bps {
                        metrics::gauge!("pegana_calibration_p95_bps", "asset" => r.symbol.clone())
                            .set(p95 as f64);
                    }
                    if let Some(p99) = r.p99_bps {
                        metrics::gauge!("pegana_calibration_p99_bps", "asset" => r.symbol)
                            .set(p99 as f64);
                    }
                }
                // Reset the alerting gauge for assets that left the active set
                // since last tick so a frozen health_code >= 2 can't page for a
                // gone asset. p95/p99 are informational (no alert) so a stale
                // value there is harmless and left as-is.
                for gone in prev_assets.difference(&current) {
                    metrics::gauge!("pegana_calibration_health_code", "asset" => gone.clone())
                        .set(CALIBRATION_HEALTH_INACTIVE);
                }
                prev_assets = current;
            }
        });
    }
    // Single path-aware CORS layer. Two-layer compositions (an inner permissive
    // layer plus an outer strict one) had a silent footgun: preflight OPTIONS
    // hit the outer first, never reached the inner, so cross-origin clients
    // adding ANY custom header to a GET /v1/audit/* request would break
    // without warning. A predicate that checks the request path solves this:
    //   - public read endpoints (audit, assets, stats, meta, openapi) echo ANY
    //     origin back → simple AND preflight GETs work cross-origin
    //   - everything else (notably /v1/ws) keeps the strict allowlist
    // No credentials: the API is public, keyless and cookie-free, and every
    // route is a GET. Reflecting any origin TOGETHER with
    // Access-Control-Allow-Credentials: true (the old setting) let any site
    // make credentialed reads; there is nothing to credential, so drop it.
    let allowed_origin_bytes: Vec<Vec<u8>> = allowed_origin_headers
        .iter()
        .map(|h| h.as_bytes().to_vec())
        .collect();
    let cors = CorsLayer::new()
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::HEAD,
            axum::http::Method::OPTIONS,
        ])
        .allow_origin(AllowOrigin::predicate(move |origin, parts| {
            let path = parts.uri.path();
            // Public, read-only surfaces: any origin allowed for the embed
            // widget, RSS readers, third-party verifiers, the web app (prod +
            // *.vercel.app previews), and the future CLI (API as a trust root).
            if is_public_read_path(path) {
                return true;
            }
            // Non-read surfaces (notably /v1/ws): strict allowlist. Predicate
            // echoes the matched origin (no wildcard).
            allowed_origin_bytes
                .iter()
                .any(|allowed| allowed.as_slice() == origin.as_bytes())
        }))
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
            // Clients may send their own request id; it is echoed back.
            axum::http::HeaderName::from_static("x-request-id"),
        ])
        // Let browser consumers read the DX headers cross-origin (they're on the
        // public read surface): the request id + the rate-limit budget.
        .expose_headers([
            axum::http::HeaderName::from_static("x-request-id"),
            axum::http::HeaderName::from_static("ratelimit-limit"),
            axum::http::HeaderName::from_static("ratelimit-remaining"),
            axum::http::HeaderName::from_static("ratelimit-reset"),
            axum::http::HeaderName::from_static("x-ratelimit-limit"),
            axum::http::HeaderName::from_static("x-ratelimit-remaining"),
            axum::http::HeaderName::from_static("x-ratelimit-reset"),
            axum::http::header::RETRY_AFTER,
        ]);

    // ADR-0014: bundle of per-route limiters. Main limit covers everything
    // (default 60/min, `default_rate_limit()`, overridable via API_RATE_LIMIT_PER_MIN); the CSV-specific
    // 10/min is hardcoded because the ADR is the source of truth — operators
    // who need to tune it should bump the ADR + the constant, not env.
    let limits = rate_limit::RateLimits {
        main: rate_limit::RateLimiter::new(cfg.api_rate_limit_per_min),
        csv: rate_limit::RateLimiter::new(10),
        ssr: rate_limit::SsrBypass::from_config(
            cfg.pegana_web_ssr_token.as_deref(),
            cfg.pegana_web_ssr_rate_limit_per_min,
        ),
    };
    info!(
        enabled = limits.ssr.is_some(),
        per_min = cfg.pegana_web_ssr_rate_limit_per_min,
        "web SSR rate-limit budget (PEGANA_WEB_SSR_TOKEN)"
    );
    rate_limit::spawn_janitor(limits.main.clone());
    rate_limit::spawn_janitor(limits.csv.clone());
    // Kill switch for the hot-read cache: `API_HOT_CACHE_ENABLED=false` +
    // `deploy.sh --config-only --services api` turns it off without a rebuild.
    let response_cache = if cfg.api_hot_cache_enabled {
        hot_cache::new_response_cache()
    } else {
        None
    };
    info!(
        enabled = response_cache.is_some(),
        "hot-read response cache (API_HOT_CACHE_ENABLED)"
    );
    hot_cache::spawn_janitor(response_cache.clone());

    // Trust Layer Phase 4 — /v1/audit/* is intentionally cross-origin
    // readable. The path-aware predicate on `cors` (above) handles the
    // policy split between public read endpoints and credentialed ones.
    // audit_router used to carry its own permissive CorsLayer; that was
    // shadowed by the outer strict layer on preflight (review finding P2-B).
    let audit_router = Router::new()
        .route("/v1/audit/:alert_id", get(routes::audit::detail))
        .route(
            "/v1/audit/:alert_id/replay-bundle",
            get(routes::audit::replay_bundle),
        )
        .route("/v1/audit/:alert_id/onchain", get(routes::audit::onchain))
        .route("/v1/audit", get(routes::audit::index))
        .route("/v1/audit.csv", get(routes::audit::csv));

    // /v1/ws lives in its OWN router, merged into `app` AFTER the compression +
    // rate-limit + body-limit layers below, so none of those layers ever touch
    // the WebSocket handshake. Compressing a `101 Switching Protocols` drops its
    // Content-Length and adds a Content-Encoding, producing an invalid upgrade
    // that browsers reject with "Unexpected response code" — the /v1/ws outage,
    // latent since the CompressionLayer landed (d266e163, 2026-05-25) and only
    // ever hit from browsers (curl/wscat omit Accept-Encoding, so they upgraded
    // fine and it went unnoticed). The ws handler has its own per-IP concurrency
    // cap (ws.rs), so exempting it from the global rate limiter is intentional
    // too. cors/trace/latency/request_id (applied AFTER the merge) still wrap it.
    let ws_router = Router::new()
        .route("/v1/ws", get(ws::ws_handler))
        .with_state(state.clone());

    let app = Router::new()
        .route("/", get(routes::health::root))
        .route("/healthz", get(routes::health::live))
        // `/health` is an undocumented alias for `/healthz`. Uptime monitors,
        // load balancers, and k8s liveness probes default to `/health`, which
        // 404'd (Gecko API report 2026-06-10). Reuses the same liveness handler;
        // the canonical, OpenAPI-documented path stays `/healthz`.
        .route("/health", get(routes::health::live))
        .route("/readyz", get(routes::health::ready))
        .route("/v1/meta/webhook-ips", get(routes::health::webhook_ips))
        .route("/v1/meta/webhook-keys", get(routes::health::webhook_keys))
        .route("/openapi.json", get(openapi::openapi_json))
        .route("/v1/assets", get(routes::assets::list))
        .route("/v1/assets/:symbol", get(routes::assets::detail))
        .route("/v1/assets/:symbol/history", get(routes::assets::history))
        .route("/v1/assets/:symbol/state", get(routes::assets::state))
        .route(
            "/v1/assets/:symbol/loop-exposure",
            get(routes::assets::loop_exposure),
        )
        .route(
            "/v1/assets/:symbol/simulate-depeg",
            get(routes::assets::simulate_depeg),
        )
        .route(
            "/v1/assets/by-mint/:mint",
            get(routes::assets::detail_by_mint),
        )
        .route(
            "/v1/assets/by-mint/:mint/state",
            get(routes::assets::state_by_mint),
        )
        .route("/v1/peg/feed", get(routes::peg::feed))
        .route("/v1/peg/feed/by-mint/:mint", get(routes::peg::feed_by_mint))
        .route("/v1/stats", get(routes::stats::summary))
        .route("/v1/calibration", get(routes::calibration::summary))
        .route("/v1/methodology/current", get(routes::methodology::current))
        // NOTE: /v1/ws is NOT here — it is a separate `ws_router` merged after
        // the compression + rate-limit layers below (see the comment above).
        .merge(audit_router)
        // Unrouted paths return a JSON 404 instead of axum's empty body, so a
        // client that `.json()`s every response (the API's JSON-everywhere
        // contract — see error.rs) doesn't break on a typo'd URL (deep-audit
        // follow-up to the Gecko API report, 2026-06-10).
        .fallback(not_found)
        .with_state(state)
        // Hot-read response cache (hot_cache.rs): single-flight, 2-5s TTL, only
        // 200s. INSIDE the rate limiter on purpose: `MatchedPath` is set here,
        // and the rate-limit headers are stamped per request after it, so a
        // cached body never carries another caller's budget.
        .layer(axum::middleware::from_fn_with_state(
            response_cache,
            hot_cache::middleware,
        ))
        .layer(axum::middleware::from_fn_with_state(
            limits,
            rate_limit::middleware,
        ))
        // P2.1 — cap inbound bodies. Applies to every POST/PATCH;
        // the WebSocket upgrade is unaffected (no body).
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BODY_BYTES))
        .layer(axum::middleware::from_fn(reject_oversized_body))
        .layer(CompressionLayer::new())
        // /v1/ws merged here — OUTSIDE compression/rate-limit/body-limit so the
        // WebSocket 101 upgrade is never mangled (see ws_router above). The
        // cors/trace/latency/request_id layers below still apply to it.
        .merge(ws_router)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(axum::middleware::from_fn(track_latency))
        // Outermost: stamp `x-request-id` on EVERY response (success or error,
        // from any inner layer) so callers/agents can quote a stable id.
        .layer(axum::middleware::from_fn(request_id));

    let bind: SocketAddr = cfg.api_bind.parse()?;
    info!("api listening on {bind}");
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}

#[derive(Debug, Deserialize)]
struct ApiConfig {
    pub database_url: String,
    pub redis_url: String,
    #[serde(default = "default_bind")]
    pub api_bind: String,
    /// Per-IP request budget for the in-memory rate limiter (sliding 60s window).
    /// /healthz and /readyz are excluded so external monitoring can poll freely.
    #[serde(default = "default_rate_limit")]
    pub api_rate_limit_per_min: u32,
    /// Shared secret the web app's SERVER sends in `x-pegana-ssr-token` so its
    /// rendering fetches use their own budget instead of the public per-IP
    /// one (see `rate_limit::SsrBypass`). Unset = no bypass. Min 32 chars.
    #[serde(default)]
    pub pegana_web_ssr_token: Option<String>,
    /// Requests per minute for the whole web tier when it presents the token.
    #[serde(default = "default_web_ssr_rate_limit")]
    pub pegana_web_ssr_rate_limit_per_min: u32,
    /// Launch switch (ADR-0020). While `false` (the default, and the
    /// calibration-window state) the discoverable read surface of the ledger;
    /// `GET /v1/audit` index and the feeds built on it; returns an empty
    /// list. Flipped to `true` at the 2026-06-11 launch.
    #[serde(default = "default_false")]
    pub feature_public_alerts: bool,
    /// Postgres connection-pool ceiling. sqlx's own default is only 10; a
    /// single slow query pins a slot for its whole duration, so under normal
    /// traffic + 30s SWR polling a 10-slot pool saturates and one bad query
    /// stalls unrelated endpoints. Companion backstop: `db_statement_timeout_ms`.
    #[serde(default = "default_db_max_connections")]
    pub db_max_connections: u32,
    /// Per-connection `statement_timeout`, in milliseconds (0 = unlimited).
    /// Default 30s; the slowest legitimate endpoint measured in prod is
    /// ~4.4s (/v1/calibration), so 30s is ~7x headroom (won't false-cancel a
    /// real query) while still killing a regressed minute-long hang before it
    /// pins a pool slot. Override via DB_STATEMENT_TIMEOUT_MS (+ --config-only).
    #[serde(default = "default_db_statement_timeout_ms")]
    pub db_statement_timeout_ms: u64,
    /// In-process single-flight cache for the hot anonymous reads
    /// (hot_cache.rs). On by default; `false` is the no-rebuild rollback.
    #[serde(default = "default_true")]
    pub api_hot_cache_enabled: bool,
}
fn default_bind() -> String {
    "0.0.0.0:8080".into()
}
fn default_rate_limit() -> u32 {
    60
}
fn default_web_ssr_rate_limit() -> u32 {
    3000
}
fn default_true() -> bool {
    true
}
fn default_false() -> bool {
    false
}
fn default_db_max_connections() -> u32 {
    25
}
fn default_db_statement_timeout_ms() -> u64 {
    30_000
}

impl ApiConfig {
    fn from_env() -> Result<Self> {
        envy::prefixed("").from_env().context("env")
    }
}

/// Builds the runtime origin allowlist. Three entries are baked in
/// (`pegana.xyz`, `www.pegana.xyz`, `localhost:3000`). Anything in
/// `CORS_EXTRA_ORIGINS` (comma-separated) is appended; malformed entries
/// are logged and dropped rather than failing boot.
fn build_allowed_origins() -> Vec<String> {
    let mut out: Vec<String> = vec![
        "https://pegana.xyz".to_string(),
        "https://www.pegana.xyz".to_string(),
        "http://localhost:3000".to_string(),
    ];
    if let Ok(extra) = std::env::var("CORS_EXTRA_ORIGINS") {
        for entry in extra.split(',') {
            let trimmed = entry.trim();
            if trimmed.is_empty() {
                continue;
            }
            // Sanity check — try to parse as a HeaderValue so the WS check
            // and the CORS layer agree on what shape an origin can have.
            if trimmed.parse::<axum::http::HeaderValue>().is_ok() {
                out.push(trimmed.to_string());
            } else {
                tracing::warn!(origin = %trimmed, "ignoring malformed CORS origin");
            }
        }
    }
    out
}

/// JSON 404 for any unrouted path (Router `.fallback`). axum's default 404 has
/// an empty body; this keeps the whole surface JSON so a client `.json()`-ing
/// every response gets a structured error even on an unknown endpoint.
async fn not_found() -> impl axum::response::IntoResponse {
    (
        axum::http::StatusCode::NOT_FOUND,
        axum::Json(serde_json::json!({
            "error": "not_found",
            "message": "no such endpoint; see GET / for the index or /openapi.json for the full surface",
        })),
    )
}

/// 413 JSON for a declared body over [`MAX_REQUEST_BODY_BYTES`], answered
/// from the headers alone. Without it an oversized POST hit the fallback,
/// which returned without reading the body; the connection then closed under
/// Caddy's still-streaming write and the client saw a 502 ("broken pipe").
/// Caddy also enforces the same cap (`request_body max_size`).
async fn reject_oversized_body(req: Request, next: Next) -> Response {
    let declared = req
        .headers()
        .get(axum::http::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok());
    if declared.is_some_and(|n| n > MAX_REQUEST_BODY_BYTES as u64) {
        return payload_too_large();
    }
    next.run(req).await
}

fn payload_too_large() -> Response {
    use axum::response::IntoResponse;
    let mut resp = (
        axum::http::StatusCode::PAYLOAD_TOO_LARGE,
        axum::Json(serde_json::json!({
            "error": "payload_too_large",
            "message": format!("request body exceeds the {} KiB limit", MAX_REQUEST_BODY_BYTES / 1024),
        })),
    )
        .into_response();
    // Tell hyper not to keep a connection whose unread body we are abandoning.
    resp.headers_mut().insert(
        axum::http::header::CONNECTION,
        axum::http::HeaderValue::from_static("close"),
    );
    resp
}

async fn track_latency(req: Request, next: Next) -> Response {
    let method = req.method().as_str().to_owned();
    let started = std::time::Instant::now();

    let response = next.run(req).await;
    let status = status_class(response.status().as_u16());

    metrics::histogram!(
        "pegana_api_request_duration_seconds",
        "method" => method,
        "status" => status,
    )
    .record(started.elapsed().as_secs_f64());

    response
}

/// Stamp an `x-request-id` on every response for debuggability (matches the
/// partner convention). Reuses a valid inbound id (from a proxy/client) so a
/// trace survives across hops; otherwise mints a UUID v4. Bounded + ASCII-only
/// so a hostile value can't inject a malformed header.
async fn request_id(req: Request, next: Next) -> Response {
    let id = req
        .headers()
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty() && s.len() <= 200 && s.bytes().all(|b| b.is_ascii_graphic()))
        .map(str::to_owned)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let mut resp = next.run(req).await;
    if let Ok(v) = axum::http::HeaderValue::from_str(&id) {
        resp.headers_mut()
            .insert(axum::http::HeaderName::from_static("x-request-id"), v);
    }
    resp
}

fn status_class(code: u16) -> &'static str {
    match code {
        200..=299 => "2xx",
        300..=399 => "3xx",
        400..=499 => "4xx",
        500..=599 => "5xx",
        _ => "other",
    }
}

/// health_code sentinel the calibration metrics task writes for an asset that
/// dropped out of the active set (`is_active=false`) since the previous tick.
/// The Prometheus exporter has no idle_timeout, so without an explicit reset a
/// retired asset's last `health_code` (e.g. 2 = miscalibrated) is served
/// forever and keeps paging `PeganaAssetMiscalibrated`. -3 is below the alert's
/// `>= 2` threshold and distinct from every value `health_code` returns
/// (ok=0/watch=1/miscalibrated=2/no_data=-1/na=-2).
const CALIBRATION_HEALTH_INACTIVE: f64 = -3.0;

/// Maps a `CalibrationHealth.health` label to the `pegana_calibration_health_code`
/// gauge value: ok=0, watch=1, miscalibrated=2 (the `PeganaAssetMiscalibrated`
/// alert threshold; `>= 2`), no_data=-1 (source dark, <200 samples in the 8d
/// window), na=-2 (non-bps thresholds shape, e.g. hyUSD's CR bands). Any
/// unrecognized label also falls back to -2 so a future health state fails
/// safe instead of silently reading as "ok".
fn health_code(health: &str) -> f64 {
    match health {
        "ok" => 0.0,
        "watch" => 1.0,
        "miscalibrated" => 2.0,
        "no_data" => -1.0,
        _ => -2.0,
    }
}

/// Raise the soft `RLIMIT_NOFILE` to the hard limit. Docker hands the process
/// a 1024 soft limit (hard 524288) unless compose sets `ulimits`; at 1024 the
/// whole api (REST accepts included) failed with EMFILE once enough sockets
/// were open. Compose also sets `ulimits: nofile`, this is the belt to it.
fn raise_nofile_limit() {
    #[cfg(unix)]
    {
        let mut lim = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        // SAFETY: getrlimit/setrlimit only read/write the struct we pass.
        unsafe {
            if libc::getrlimit(libc::RLIMIT_NOFILE, &mut lim) != 0 {
                tracing::warn!("getrlimit(RLIMIT_NOFILE) failed");
                return;
            }
            let before = lim.rlim_cur;
            if lim.rlim_cur < lim.rlim_max {
                lim.rlim_cur = lim.rlim_max;
                if libc::setrlimit(libc::RLIMIT_NOFILE, &lim) != 0 {
                    tracing::warn!(soft = before, "setrlimit(RLIMIT_NOFILE) failed");
                    return;
                }
            }
            info!(
                soft_before = before,
                soft = lim.rlim_cur,
                hard = lim.rlim_max,
                "nofile limit"
            );
        }
    }
}

/// Export open fds and the soft fd limit every 15s (`pegana_api_open_fds`,
/// `pegana_api_fd_limit`), so an alert can fire well before EMFILE. Linux
/// only (`/proc/self/fd`); a no-op elsewhere.
fn spawn_fd_gauges() {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            tick.tick().await;
            if let Ok(dir) = std::fs::read_dir("/proc/self/fd") {
                metrics::gauge!("pegana_api_open_fds").set(dir.count() as f64);
            }
            #[cfg(unix)]
            {
                let mut lim = libc::rlimit {
                    rlim_cur: 0,
                    rlim_max: 0,
                };
                // SAFETY: getrlimit only writes the struct we pass.
                if unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut lim) } == 0 {
                    metrics::gauge!("pegana_api_fd_limit").set(lim.rlim_cur as f64);
                }
            }
        }
    });
}

fn init_tracing() {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,tower_http=info"));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().json())
        .init();
}

/// Public, read-only API surfaces that any origin may fetch cross-origin
/// (embed widget, RSS, third-party verifiers, the CLI trust-root, and the web
/// app on prod pegana.xyz AND *.vercel.app previews). A new public route MUST
/// be listed here or the browser silently fails its CORS preflight; the exact
/// miss that left /v1/calibration unreachable from the web app.
fn is_public_read_path(path: &str) -> bool {
    path.starts_with("/v1/audit")
        || path.starts_with("/v1/assets")
        || path.starts_with("/v1/stats")
        || path.starts_with("/v1/calibration")
        || path.starts_with("/v1/methodology")
        || path.starts_with("/v1/meta")
        || path.starts_with("/v1/peg")
        || path == "/openapi.json"
}

#[cfg(test)]
mod tests {
    use super::{health_code, is_public_read_path, status_class};

    // ── e2e + stress: the real Router with the DX-header + rate-limit stack ──
    // Drives the middleware over HTTP (no DB) via `ServiceExt::oneshot`: proves
    // `x-request-id` is stamped on EVERY response, the `RateLimit-*` headers are
    // present (+ legacy `X-RateLimit-*` mirror), an inbound request id is echoed,
    // and the limiter holds under BOTH sequential and concurrent load (429 +
    // Retry-After + remaining 0, no panic/deadlock on the shared limiter).
    /// An oversized declared body is a 413 JSON answered from the headers (not
    /// a fallback 404 that leaves the body unread and makes Caddy 502).
    #[tokio::test]
    async fn oversized_body_is_413_json() {
        use axum::body::Body;
        use axum::http::{header, Request, StatusCode};
        use axum::Router;
        use tower::ServiceExt;

        let app = Router::new()
            .fallback(super::not_found)
            .layer(axum::middleware::from_fn(super::reject_oversized_body));
        let big = Request::post("/v1/replay")
            .header(header::CONTENT_LENGTH, "2000000")
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(big).await.unwrap();
        assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
        let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["error"], "payload_too_large");

        let ok = Request::post("/v1/replay")
            .header(header::CONTENT_LENGTH, "10")
            .body(Body::from("0123456789"))
            .unwrap();
        assert_eq!(
            app.oneshot(ok).await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn dx_headers_and_rate_limit_e2e_and_stress() {
        use axum::body::Body;
        use axum::extract::connect_info::ConnectInfo;
        use axum::http::{header, Request, StatusCode};
        use axum::routing::get;
        use axum::Router;
        use std::net::SocketAddr;
        use tower::ServiceExt;

        const LIMIT: u32 = 5;
        let limits = crate::rate_limit::RateLimits {
            main: crate::rate_limit::RateLimiter::new(LIMIT),
            csv: crate::rate_limit::RateLimiter::new(10),
            ssr: None,
        };
        let app = Router::new()
            .route("/ping", get(|| async { "ok" }))
            .layer(axum::middleware::from_fn_with_state(
                limits,
                crate::rate_limit::middleware,
            ))
            .layer(axum::middleware::from_fn(super::request_id));

        let mk = |ip: SocketAddr, xrid: Option<&str>| {
            let mut b = Request::builder().uri("/ping");
            if let Some(v) = xrid {
                b = b.header("x-request-id", v);
            }
            let mut req = b.body(Body::empty()).unwrap();
            req.extensions_mut().insert(ConnectInfo(ip));
            req
        };

        // 1) First request: 200, x-request-id minted, RateLimit-* present (+ mirror).
        let a: SocketAddr = "203.0.113.9:5555".parse().unwrap();
        let resp = app.clone().oneshot(mk(a, None)).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let h = resp.headers();
        assert!(
            h.get("x-request-id").is_some(),
            "x-request-id stamped on 200"
        );
        assert_eq!(
            h.get("ratelimit-limit").and_then(|v| v.to_str().ok()),
            Some("5")
        );
        assert!(h.get("ratelimit-remaining").is_some());
        assert!(h.get("ratelimit-reset").is_some());
        assert!(
            h.get("x-ratelimit-limit").is_some(),
            "legacy X-RateLimit mirror"
        );

        // 2) Inbound x-request-id is echoed (trace survives across hops).
        let resp = app
            .clone()
            .oneshot(mk(a, Some("trace-abc-42")))
            .await
            .unwrap();
        assert_eq!(
            resp.headers()
                .get("x-request-id")
                .and_then(|v| v.to_str().ok()),
            Some("trace-abc-42"),
        );

        // 3) Sequential stress from a FRESH ip → exactly LIMIT pass, then 429s
        //    carry Retry-After + remaining 0 and are still stamped.
        let b: SocketAddr = "198.51.100.7:6666".parse().unwrap();
        let (mut allowed, mut denied) = (0u32, 0u32);
        for _ in 0..(LIMIT * 20) {
            let resp = app.clone().oneshot(mk(b, None)).await.unwrap();
            assert!(
                resp.headers().get("x-request-id").is_some(),
                "every response is stamped"
            );
            match resp.status() {
                StatusCode::OK => allowed += 1,
                StatusCode::TOO_MANY_REQUESTS => {
                    denied += 1;
                    let h = resp.headers();
                    assert_eq!(
                        h.get(header::RETRY_AFTER).and_then(|v| v.to_str().ok()),
                        Some("60")
                    );
                    assert_eq!(
                        h.get("ratelimit-remaining").and_then(|v| v.to_str().ok()),
                        Some("0")
                    );
                }
                other => panic!("unexpected status {other}"),
            }
        }
        assert_eq!(
            allowed, LIMIT,
            "exactly the budget passes before throttling"
        );
        assert!(denied > 0, "sustained load must be throttled");

        // 4) CONCURRENT stress: 300 parallel requests from a fresh ip. The shared
        //    Mutex-backed limiter must not panic/deadlock, never allow more than
        //    the budget, and every response must carry the DX headers.
        let c: SocketAddr = "192.0.2.55:7777".parse().unwrap();
        let mut set = tokio::task::JoinSet::new();
        for _ in 0..300 {
            let app = app.clone();
            set.spawn(async move {
                let mut req = Request::builder().uri("/ping").body(Body::empty()).unwrap();
                req.extensions_mut().insert(ConnectInfo(c));
                let resp = app.oneshot(req).await.unwrap();
                let has_id = resp.headers().get("x-request-id").is_some();
                let has_rl = resp.headers().get("ratelimit-limit").is_some();
                (resp.status(), has_id, has_rl)
            });
        }
        let (mut ok, mut total) = (0u32, 0u32);
        while let Some(res) = set.join_next().await {
            let (status, has_id, has_rl) = res.expect("no task panicked under load");
            assert!(has_id, "x-request-id present under concurrent load");
            assert!(has_rl, "RateLimit-* present under concurrent load");
            if status == StatusCode::OK {
                ok += 1;
            }
            total += 1;
        }
        assert_eq!(total, 300, "all concurrent requests completed");
        assert!(
            ok <= LIMIT,
            "concurrent allows never exceed the budget (got {ok})"
        );
    }

    // ── regression: /v1/ws MUST NOT sit behind CompressionLayer (the 2026-05-25
    //    outage). tower-http compresses a `101` upgrade → adds Content-Encoding,
    //    drops Content-Length → an invalid handshake browsers reject with
    //    "Unexpected response code". Prod fixes this by merging the ws_router
    //    AFTER `.layer(CompressionLayer)` (a route added after a layer is not
    //    wrapped by it). This locks that structural invariant: a route merged
    //    post-compression is uncompressed, a sibling added pre-compression is
    //    compressed — both with Accept-Encoding: gzip. Move /v1/ws back inside
    //    the layer and this fails.
    #[tokio::test]
    async fn route_merged_after_compression_layer_is_not_compressed() {
        use axum::body::Body;
        use axum::http::{header, Request, StatusCode};
        use axum::routing::get;
        use axum::Router;
        use tower::ServiceExt;

        // 4 KB of text: > SizeAbove(32) and a compressible content-type, so the
        // default predicate WOULD compress it if the layer applied.
        let app = Router::new()
            .route("/rest", get(|| async { "x".repeat(4096) }))
            .layer(tower_http::compression::CompressionLayer::new())
            // mirrors prod: the ws-style route is merged AFTER the layer.
            .merge(Router::new().route("/ws-like", get(|| async { "x".repeat(4096) })));

        let call = |uri: &'static str| {
            let req = Request::builder()
                .uri(uri)
                .header(header::ACCEPT_ENCODING, "gzip")
                .body(Body::empty())
                .unwrap();
            app.clone().oneshot(req)
        };

        // Route UNDER the layer → gzip-compressed.
        let rest = call("/rest").await.unwrap();
        assert_eq!(rest.status(), StatusCode::OK);
        assert_eq!(
            rest.headers()
                .get(header::CONTENT_ENCODING)
                .and_then(|v| v.to_str().ok()),
            Some("gzip"),
            "routes under CompressionLayer are gzip-compressed"
        );

        // Route merged AFTER the layer → NOT compressed. This is the exact
        // exemption that keeps the /v1/ws 101 upgrade intact for browsers.
        let ws = call("/ws-like").await.unwrap();
        assert_eq!(ws.status(), StatusCode::OK);
        assert!(
            ws.headers().get(header::CONTENT_ENCODING).is_none(),
            "a route merged after CompressionLayer must NOT be compressed (protects /v1/ws)"
        );
    }

    #[test]
    fn status_class_uses_low_cardinality_response_buckets() {
        assert_eq!(status_class(200), "2xx");
        assert_eq!(status_class(204), "2xx");
        assert_eq!(status_class(301), "3xx");
        assert_eq!(status_class(404), "4xx");
        assert_eq!(status_class(503), "5xx");
        assert_eq!(status_class(199), "other");
        assert_eq!(status_class(600), "other");
    }

    #[test]
    fn health_code_covers_every_calibration_state() {
        assert_eq!(health_code("ok"), 0.0);
        assert_eq!(health_code("watch"), 1.0);
        assert_eq!(health_code("miscalibrated"), 2.0);
        assert_eq!(health_code("no_data"), -1.0);
        assert_eq!(health_code("na"), -2.0);
        // Unrecognized label fails safe rather than reading as "ok".
        assert_eq!(health_code("bogus"), -2.0);
    }

    #[test]
    fn calibration_and_read_surfaces_are_cors_public() {
        for p in [
            "/v1/assets",
            "/v1/calibration",
            "/v1/stats",
            "/v1/audit",
            "/v1/methodology/x",
            "/v1/peg",
            "/v1/meta/webhook-ips",
            "/openapi.json",
        ] {
            assert!(is_public_read_path(p), "{p} must be CORS-public");
        }
    }

    #[test]
    fn non_read_surfaces_are_not_cors_public() {
        // /v1/ws stays on the strict allowlist even though every REST surface
        // is now public: the socket carries a live stream, not a cacheable read.
        for p in ["/v1/ws", "/v1/internal/anything"] {
            assert!(!is_public_read_path(p), "{p} must NOT be CORS-public");
        }
    }
}
