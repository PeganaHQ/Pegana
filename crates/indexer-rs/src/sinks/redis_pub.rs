//! Redis pub/sub publishers.

use anyhow::Result;
use redis::AsyncCommands;

pub async fn publish<T: serde::Serialize>(
    mut conn: redis::aio::ConnectionManager,
    channel: &str,
    payload: &T,
) -> Result<()> {
    let json = serde_json::to_string(payload)?;
    let _: i64 = conn.publish(channel, json).await?;
    Ok(())
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
