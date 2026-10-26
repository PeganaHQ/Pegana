//! Per-source supervision and the aggregated source-health view behind `/healthz`.

use anyhow::Result;
use std::collections::BTreeMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

const MAX_BACKOFF_SECS: u64 = 60;
/// A run at least this long counts as healthy: the next restart starts from 1 s.
const HEALTHY_RUN: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, PartialEq, Eq)]
enum SourceState {
    Down,
    Live,
}

/// Which expected sources are currently running. A source that finishes on its
/// own (no assets configured) is removed from the expected set.
#[derive(Default)]
pub struct Health {
    sources: Mutex<BTreeMap<&'static str, SourceState>>,
}

impl Health {
    fn lock(&self) -> std::sync::MutexGuard<'_, BTreeMap<&'static str, SourceState>> {
        self.sources.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn register(&self, name: &'static str) {
        self.lock().insert(name, SourceState::Down);
    }

    fn set_live(&self, name: &'static str, live: bool) {
        if let Some(state) = self.lock().get_mut(name) {
            *state = if live {
                SourceState::Live
            } else {
                SourceState::Down
            };
        }
    }

    fn finish(&self, name: &'static str) {
        self.lock().remove(name);
    }

    /// `(http_ok, json_body)`. Healthy while at least one expected source is live
    /// (the body names the degraded ones); unhealthy only when every expected
    /// source is down. One misconfigured source must not block a deploy.
    pub fn report(&self) -> (bool, String) {
        let sources = self.lock();
        let live: Vec<&str> = sources
            .iter()
            .filter(|(_, s)| **s == SourceState::Live)
            .map(|(n, _)| *n)
            .collect();
        let down: Vec<&str> = sources
            .iter()
            .filter(|(_, s)| **s == SourceState::Down)
            .map(|(n, _)| *n)
            .collect();
        let ok = sources.is_empty() || !live.is_empty();
        let status = if !ok {
            "down"
        } else if down.is_empty() {
            "ok"
        } else {
            "degraded"
        };
        let body = serde_json::json!({ "status": status, "live": live, "down": down });
        (ok, body.to_string())
    }
}

/// Marks a source live for as long as it runs, including when it panics (a plain
/// post-`await` reset is skipped on unwind and would leave the gauge at 1).
pub struct SourceTaskUpGuard(&'static str, Arc<Health>, bool);

impl SourceTaskUpGuard {
    pub fn new(source: &'static str, health: Arc<Health>) -> Self {
        health.set_live(source, true);
        metrics::gauge!("pegana_source_task_up", "source" => source).set(1.0);
        Self(source, health, false)
    }

    /// The source returned `Ok(())` on its own, i.e. it is intentionally idle
    /// (feature off, or only inactive assets). Its gauge becomes NaN instead of
    /// 0 so `PeganaSourceTaskDown` (`== 0`) stays quiet; a crash still hits 0.
    pub fn mark_idle(&mut self) {
        self.2 = true;
    }
}

impl Drop for SourceTaskUpGuard {
    fn drop(&mut self) {
        let value = if self.2 { f64::NAN } else { 0.0 };
        metrics::gauge!("pegana_source_task_up", "source" => self.0).set(value);
        self.1.set_live(self.0, false);
    }
}

/// Run `run` until shutdown, restarting it after an error or panic with an
/// exponential backoff (1 s → 60 s, reset after a run of [`HEALTHY_RUN`]). A
/// clean `Ok(())` ends supervision and drops the source from the expected set.
pub async fn supervise<F, Fut>(
    name: &'static str,
    health: Arc<Health>,
    shutdown: CancellationToken,
    run: F,
) -> Result<()>
where
    F: Fn(CancellationToken) -> Fut,
    Fut: Future<Output = Result<()>> + Send + 'static,
{
    health.register(name);
    let mut backoff_secs = 1u64;
    loop {
        let started = Instant::now();
        let guard_health = health.clone();
        let fut = run(shutdown.clone());
        let result = tokio::spawn(async move {
            let mut up = SourceTaskUpGuard::new(name, guard_health);
            let result = fut.await;
            if result.is_ok() {
                up.mark_idle();
            }
            result
        })
        .await;
        if shutdown.is_cancelled() {
            return Ok(());
        }
        match result {
            Ok(Ok(())) => {
                health.finish(name);
                return Ok(());
            }
            Ok(Err(ref e)) => error!(source = name, error = %e, "source task failed; restarting"),
            Err(ref e) => error!(source = name, error = %e, "source task panicked; restarting"),
        }
        if started.elapsed() >= HEALTHY_RUN {
            backoff_secs = 1;
        }
        tokio::select! {
            _ = shutdown.cancelled() => return Ok(()),
            _ = tokio::time::sleep(Duration::from_secs(backoff_secs)) => {}
        }
        backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
    }
}

/// Minimal HTTP responder: `200` with the JSON health body while any expected
/// source is live, `503` when all are down.
pub fn spawn_healthz(bind: &str, health: Arc<Health>) {
    let bind = bind.to_string();
    tokio::spawn(async move {
        let listener = match TcpListener::bind(&bind).await {
            Ok(listener) => listener,
            Err(e) => {
                error!(addr = %bind, error = %e, "healthz bind failed");
                return;
            }
        };
        info!(addr = %bind, "healthz listening");
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                continue;
            };
            let health = health.clone();
            tokio::spawn(async move {
                let mut request = [0u8; 1024];
                let _ =
                    tokio::time::timeout(Duration::from_secs(2), socket.read(&mut request)).await;
                let (ok, body) = health.report();
                let line = if ok {
                    "200 OK"
                } else {
                    "503 Service Unavailable"
                };
                let response = format!(
                    "HTTP/1.1 {line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test(start_paused = true)]
    async fn panicking_source_restarts_with_growing_backoff() {
        let health = Arc::new(Health::default());
        let shutdown = CancellationToken::new();
        let starts = Arc::new(Mutex::new(Vec::<Instant>::new()));
        let log = starts.clone();
        let task = tokio::spawn(supervise("t", health, shutdown.clone(), move |_| {
            log.lock().unwrap().push(Instant::now());
            async { panic!("boom") }
        }));
        tokio::time::sleep(Duration::from_secs(8)).await;
        shutdown.cancel();
        task.await.unwrap().unwrap();
        let starts = starts.lock().unwrap();
        let gaps: Vec<u64> = starts.windows(2).map(|w| (w[1] - w[0]).as_secs()).collect();
        assert_eq!(gaps, vec![1, 2, 4]);
    }

    #[tokio::test(start_paused = true)]
    async fn long_healthy_run_resets_the_backoff() {
        let health = Arc::new(Health::default());
        let shutdown = CancellationToken::new();
        let calls = Arc::new(AtomicUsize::new(0));
        let starts = Arc::new(Mutex::new(Vec::<Instant>::new()));
        let (c, log) = (calls.clone(), starts.clone());
        let task = tokio::spawn(supervise("t", health, shutdown.clone(), move |_| {
            let n = c.fetch_add(1, Ordering::SeqCst);
            log.lock().unwrap().push(Instant::now());
            async move {
                if n == 2 {
                    tokio::time::sleep(Duration::from_secs(61)).await;
                }
                anyhow::bail!("fail")
            }
        }));
        tokio::time::sleep(Duration::from_secs(80)).await;
        shutdown.cancel();
        task.await.unwrap().unwrap();
        let starts = starts.lock().unwrap();
        let gaps: Vec<u64> = starts.windows(2).map(|w| (w[1] - w[0]).as_secs()).collect();
        // 1 s, 2 s, then a 61 s run + a reset 1 s wait (not the grown 4 s).
        assert_eq!(&gaps[..3], &[1, 2, 62]);
    }

    #[tokio::test(start_paused = true)]
    async fn clean_exit_drops_the_source_from_the_expected_set() {
        let health = Arc::new(Health::default());
        supervise("t", health.clone(), CancellationToken::new(), |_| async {
            Ok(())
        })
        .await
        .unwrap();
        let (ok, body) = health.report();
        assert!(ok);
        assert!(body.contains("\"live\":[]") && body.contains("\"down\":[]"));
    }

    #[tokio::test(start_paused = true)]
    async fn cancel_returns_promptly_even_while_backing_off() {
        let health = Arc::new(Health::default());
        let shutdown = CancellationToken::new();
        let task = tokio::spawn(supervise("t", health, shutdown.clone(), |_| async {
            anyhow::bail!("fail")
        }));
        tokio::time::sleep(Duration::from_millis(1500)).await;
        let cancelled_at = Instant::now();
        shutdown.cancel();
        task.await.unwrap().unwrap();
        assert!(cancelled_at.elapsed() < Duration::from_millis(100));
    }

    #[test]
    fn health_is_ok_while_any_source_is_live_and_down_only_when_all_are() {
        let h = Health::default();
        assert!(h.report().0, "no sources registered");
        h.register("a");
        h.register("b");
        let (ok, body) = h.report();
        assert!(!ok, "all expected sources down → 503");
        assert!(body.contains("\"status\":\"down\""));
        h.set_live("a", true);
        let (ok, body) = h.report();
        assert!(ok, "one live source keeps /healthz at 200");
        assert!(body.contains("\"status\":\"degraded\"") && body.contains("\"down\":[\"b\"]"));
        h.set_live("b", true);
        assert!(h.report().1.contains("\"status\":\"ok\""));
    }
}
