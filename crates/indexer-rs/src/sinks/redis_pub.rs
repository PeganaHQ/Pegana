//! Redis pub/sub publishers.

use anyhow::Result;
use redis::AsyncCommands;
use std::sync::{Mutex, OnceLock};

/// Consecutive Redis timeouts before the connection manager is rebuilt.
const REBUILD_AFTER_TIMEOUTS: u32 = 3;

/// Response/connect timeout for every Redis connection the indexer opens.
pub fn connection_config() -> redis::aio::ConnectionManagerConfig {
    redis::aio::ConnectionManagerConfig::new()
        .set_response_timeout(std::time::Duration::from_secs(5))
        .set_connection_timeout(std::time::Duration::from_secs(5))
}

/// Counts consecutive timeouts so a wedged connection gets replaced.
#[derive(Default)]
struct TimeoutTracker {
    consecutive: u32,
}

impl TimeoutTracker {
    fn on_success(&mut self) {
        self.consecutive = 0;
    }

    /// Returns `true` when the connection should be rebuilt (and resets).
    fn on_timeout(&mut self) -> bool {
        self.consecutive += 1;
        if self.consecutive >= REBUILD_AFTER_TIMEOUTS {
            self.consecutive = 0;
            true
        } else {
            false
        }
    }
}

static TRACKER: Mutex<TimeoutTracker> = Mutex::new(TimeoutTracker { consecutive: 0 });
static CLIENT: OnceLock<redis::Client> = OnceLock::new();
/// Replacement for the manager handed in by callers, installed after a rebuild.
static REPLACEMENT: Mutex<Option<redis::aio::ConnectionManager>> = Mutex::new(None);

/// Register the client used for rebuilds and make `pegana_redis_timeouts_total`
/// visible at 0 so `increase()` sees the very first timeout.
pub fn init(client: redis::Client) {
    let _ = CLIENT.set(client);
    metrics::counter!("pegana_redis_timeouts_total").increment(0);
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

async fn rebuild_connection() {
    let Some(client) = CLIENT.get() else { return };
    match redis::aio::ConnectionManager::new_with_config(client.clone(), connection_config()).await
    {
        Ok(conn) => {
            *lock(&REPLACEMENT) = Some(conn);
            tracing::warn!("redis connection rebuilt after repeated timeouts");
        }
        Err(e) => tracing::warn!(error = %e, "redis connection rebuild failed"),
    }
}

pub async fn publish<T: serde::Serialize>(
    conn: redis::aio::ConnectionManager,
    channel: &str,
    payload: &T,
) -> Result<()> {
    let json = serde_json::to_string(payload)?;
    let mut conn = lock(&REPLACEMENT).clone().unwrap_or(conn);
    match conn.publish::<_, _, i64>(channel, json).await {
        Ok(_) => {
            lock(&TRACKER).on_success();
            Ok(())
        }
        Err(e) => {
            if e.is_timeout() {
                metrics::counter!("pegana_redis_timeouts_total").increment(1);
                let rebuild = lock(&TRACKER).on_timeout();
                if rebuild {
                    rebuild_connection().await;
                }
            }
            Err(e.into())
        }
    }
}

/// Like [`publish`] but also updates the per-source liveness gauge
/// `pegana_source_last_publish_timestamp{source=<source>}` with the current
/// Unix timestamp so Prometheus/alertmanager can detect a silently-dead source.
pub async fn publish_tracked<T: serde::Serialize>(
    conn: redis::aio::ConnectionManager,
    channel: &str,
    payload: &T,
    source: &'static str,
) -> Result<()> {
    publish(conn, channel, payload).await?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();
    metrics::gauge!("pegana_source_last_publish_timestamp", "source" => source).set(ts);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rebuild_fires_on_the_third_consecutive_timeout_only() {
        let mut t = TimeoutTracker::default();
        assert!(!t.on_timeout());
        assert!(!t.on_timeout());
        t.on_success();
        assert!(!t.on_timeout(), "a success resets the streak");
        assert!(!t.on_timeout());
        assert!(t.on_timeout());
        assert!(!t.on_timeout(), "streak restarts after a rebuild");
    }
}
