//! Shared observability bootstrap (Sentry).
//!
//! Every service calls [`init_sentry`] early in `main()`. The returned guard
//! must be held for the program's lifetime — when dropped, in-flight events
//! are flushed. If `SENTRY_DSN` is unset (dev/local), returns `None` and we
//! run without Sentry.

use metrics_exporter_prometheus::{Matcher, PrometheusBuilder};
use sentry::ClientInitGuard;
use std::env;
use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Initialize Sentry from env. Returns `None` when `SENTRY_DSN` is unset so
/// dev environments don't need a DSN. Caller must bind the guard for the
/// duration of `main` (typically `let _sentry = init_sentry("indexer");`).
///
/// `service_name` becomes the `server_name` tag, which makes the per-service
/// project filter in Sentry trivial.
pub fn init_sentry(service_name: &str) -> Option<ClientInitGuard> {
    let dsn = env::var("SENTRY_DSN").ok().filter(|s| !s.is_empty())?;
    let environment = env::var("SENTRY_ENVIRONMENT")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "production".to_string());
    let traces_sample_rate: f32 = env::var("SENTRY_TRACES_SAMPLE_RATE")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.05);
    let release = env::var("SENTRY_RELEASE")
        .ok()
        .filter(|s| !s.is_empty())
        .map(Into::into)
        .or_else(|| sentry::release_name!());

    let guard = sentry::init((
        dsn,
        sentry::ClientOptions {
            release: release.clone(),
            environment: Some(environment.clone().into()),
            server_name: Some(service_name.to_string().into()),
            traces_sample_rate,
            send_default_pii: false,
            attach_stacktrace: true,
            ..Default::default()
        },
    ));
    tracing::info!(
        service = service_name,
        environment,
        release = release.as_deref().unwrap_or("unset"),
        traces_sample_rate,
        "sentry initialized"
    );
    Some(guard)
}

/// Install a Prometheus recorder and start an HTTP exporter on `bind`.
///
/// Reads `METRICS_BIND` from the environment with the supplied fallback when
/// unset/empty. Logs a warning and returns without installing if the bind is
/// invalid or the exporter fails to start — that way a misconfigured metrics
/// endpoint never takes down the whole service.
///
/// Calls `metrics::counter!()` etc. across the workspace become no-ops until
/// this is called, so every service's `main()` should call it early.
pub fn init_metrics(default_bind: &str) {
    let bind_str = env::var("METRICS_BIND")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_bind.to_string());
    let addr: SocketAddr = match bind_str.parse() {
        Ok(a) => a,
        Err(e) => {
            tracing::warn!(bind = %bind_str, error = %e, "invalid METRICS_BIND · metrics disabled");
            return;
        }
    };
    // Explicit buckets (seconds) for the end-to-end signal-latency histogram —
    // tuned to the pipeline's real range (sub-second dispatch up to the
    // ~minutes EWMA/confirm tail) so p50/p95/p99 are meaningful instead of the
    // exporter's default power-of-two summary. Only the engine records this
    // metric; setting the buckets here (shared bootstrap) is harmless for the
    // other services.
    const LATENCY_BUCKETS: &[f64] = &[
        0.25, 0.5, 1.0, 2.0, 3.0, 5.0, 8.0, 13.0, 21.0, 34.0, 55.0, 89.0, 144.0, 300.0,
    ];
    let builder = PrometheusBuilder::new().with_http_listener(addr);
    let builder = match builder.set_buckets_for_metric(
        Matcher::Full("pegana_signal_latency_seconds".to_string()),
        LATENCY_BUCKETS,
    ) {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(error = %e, "signal-latency bucket config failed · default summary");
            PrometheusBuilder::new().with_http_listener(addr)
        }
    };
    match builder.install() {
        Ok(()) => tracing::info!(%addr, "prometheus exporter listening"),
        Err(e) => {
            tracing::warn!(%addr, error = %e, "prometheus exporter install failed · metrics disabled")
        }
    }
}

/// Spawn a minimal HTTP/1.1 healthz responder on `bind`. Replies `200 OK ok` to
/// any TCP request — used by docker-compose healthchecks and orchestration so
/// liveness is observable without coupling to the metrics endpoint (which can
/// be paused under contention).
///
/// Bind failures log a warning and exit silently — the service stays up, just
/// without a healthz signal, which is the right tradeoff for non-critical
/// observability paths.
pub fn spawn_healthz(bind: &str) {
    let bind = bind.to_string();
    tokio::spawn(async move {
        let listener = match TcpListener::bind(&bind).await {
            Ok(l) => l,
            Err(e) => {
                tracing::warn!(addr = %bind, error = %e, "healthz bind failed");
                return;
            }
        };
        tracing::info!(addr = %bind, "healthz listening");
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                continue;
            };
            tokio::spawn(async move {
                // Drain whatever HTTP request bytes came in; we don't parse —
                // healthz is path-agnostic on purpose so any GET works.
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf).await;
                let _ = sock
                    .write_all(
                        b"HTTP/1.1 200 OK\r\n\
                          Content-Type: text/plain\r\n\
                          Content-Length: 2\r\n\
                          Connection: close\r\n\
                          \r\n\
                          ok",
                    )
                    .await;
                let _ = sock.shutdown().await;
            });
        }
    });
}
