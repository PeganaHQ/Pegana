//! Replay of deliveries that were deferred (circuit breaker open, backlog or
//! queue full) once the subscriber is healthy again.
//!
//! Deferred rows are `webhook_dead_letter` rows whose `last_error` starts with
//! the deferral marker, with `replayed_at` and `replay_failed_at` NULL. They are
//! re-sent oldest first under their original event id, one attempt each (a
//! retry chain per row would let one bad payload hold the whole queue):
//!
//! - success: stamp `replayed_at`;
//! - permanent rejection (HTTP 4xx other than 408/429): count it on the row,
//!   give the row up after `MAX_REPLAY_REJECTIONS`, and carry on with the next;
//! - anything else (breaker, transport error, 5xx, 408/429): stop, leaving the
//!   rest queued for the next trigger.
//!
//! Triggers: any successful delivery to the subscriber, and a periodic sweeper.

use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use pegana_common::webhook_channel::{render_for_channel, ChannelType};
use sqlx::PgPool;
use uuid::Uuid;

use crate::delivery::global_pool;
use crate::webhook::{dispatch_replay, DispatchConfig};

/// Rows replayed per trigger; the next trigger continues with the rest.
const REPLAY_BATCH: i64 = 200;
/// Permanent rejections before a deferred row is given up on.
const MAX_REPLAY_REJECTIONS: i16 = 3;
/// How often the sweeper looks for subscribers with deferred rows.
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

// The marker is written as a literal in the SQL below (the partial index in
// migration 0086 has the same predicate, so the planner can use it); this
// asserts it still equals the constant the writers use.
const _: () = {
    let a = crate::delivery::BREAKER_DEAD_LETTER_PREFIX.as_bytes();
    let b = b"deferred:";
    assert!(a.len() == b.len());
    let mut i = 0;
    while i < a.len() {
        assert!(a[i] == b[i]);
        i += 1;
    }
};

/// Does the subscription have deferred deliveries waiting?
pub async fn has_unreplayed(pg: &PgPool, sub_id: Uuid) -> bool {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM webhook_dead_letter d \
           JOIN webhook_subscriptions ws ON ws.id = d.subscription_id \
          WHERE d.subscription_id = $1 AND d.replayed_at IS NULL \
            AND d.replay_failed_at IS NULL AND d.last_error LIKE 'deferred:%' \
            AND ws.is_active = TRUE)",
    )
    .bind(sub_id)
    .fetch_one(pg)
    .await
    .unwrap_or(false)
}

/// Start a replay for `sub_id` in the background pool when it has deferred
/// rows. Never waits for capacity: when no background slot is free the replay is
/// skipped (the sweeper picks it up), so a live delivery and the background
/// workers cannot block on each other.
pub async fn kick(pg: &PgPool, cfg: &Arc<DispatchConfig>, sub_id: Uuid) {
    kick_on(global_pool(), pg, cfg, sub_id).await;
}

/// [`kick`] against an explicit pool.
pub async fn kick_on(
    pool: &Arc<crate::delivery::DeliveryPool>,
    pg: &PgPool,
    cfg: &Arc<DispatchConfig>,
    sub_id: Uuid,
) {
    if !has_unreplayed(pg, sub_id).await {
        return;
    }
    let (pg, cfg) = (pg.clone(), cfg.clone());
    // Fire and forget: the replay reports through logs and metrics.
    let _ = pool.try_spawn_background(async move {
        replay_deferred(&pg, &cfg, sub_id).await;
    });
}

/// Periodically replay for every subscriber that has deferred rows and whose
/// breaker is not open, so recovery does not depend on a live alert arriving.
pub fn spawn_sweeper(pg: PgPool, cfg: Arc<DispatchConfig>) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(SWEEP_INTERVAL);
        tick.tick().await;
        loop {
            tick.tick().await;
            let subs: Vec<Uuid> = match sqlx::query_scalar(
                "SELECT DISTINCT d.subscription_id FROM webhook_dead_letter d \
                   JOIN webhook_subscriptions ws ON ws.id = d.subscription_id \
                  WHERE d.replayed_at IS NULL AND d.replay_failed_at IS NULL \
                    AND d.last_error LIKE 'deferred:%' AND ws.is_active = TRUE",
            )
            .fetch_all(&pg)
            .await
            {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!(?e, "deferred replay sweep query failed");
                    continue;
                }
            };
            for sub in subs {
                if global_pool().breaker.is_open(sub, Instant::now()) {
                    continue;
                }
                kick(&pg, &cfg, sub).await;
            }
        }
    });
}

/// Re-send up to one batch of deferred deliveries. Returns how many were sent.
/// At most one replay per subscription runs at a time.
pub async fn replay_deferred(pg: &PgPool, cfg: &Arc<DispatchConfig>, sub_id: Uuid) -> usize {
    let pool = global_pool();
    let Some(_guard) = pool.try_begin_replay(sub_id) else {
        return 0;
    };
    // One attempt per replayed row.
    let once = Arc::new(DispatchConfig {
        max_attempts: 1,
        ..(**cfg).clone()
    });
    #[allow(clippy::type_complexity)]
    let rows: Vec<(
        Uuid,
        Uuid,
        Option<Uuid>,
        serde_json::Value,
        String,
        String,
        i16,
    )> = match sqlx::query_as(
        "SELECT d.id, d.alert_id, d.event_id, d.payload, ws.url, ws.channel_type, \
                    d.replay_attempts \
             FROM webhook_dead_letter d \
             JOIN webhook_subscriptions ws ON ws.id = d.subscription_id \
             WHERE d.subscription_id = $1 AND d.replayed_at IS NULL \
               AND d.replay_failed_at IS NULL AND d.last_error LIKE 'deferred:%' \
               AND ws.is_active = TRUE \
             ORDER BY d.failed_at \
             LIMIT $2",
    )
    .bind(sub_id)
    .bind(REPLAY_BATCH)
    .fetch_all(pg)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(?e, %sub_id, "deferred webhook replay query failed");
            return 0;
        }
    };
    if rows.is_empty() {
        return 0;
    }
    tracing::info!(%sub_id, count = rows.len(), "replaying deferred webhook deliveries");
    let mut sent = 0;
    for (row_id, alert_id, event_id, payload, url, channel_type, attempts) in rows {
        let ch = ChannelType::from_str(&channel_type).unwrap_or_default();
        let rendered = render_for_channel(ch, &payload);
        match dispatch_replay(
            &once,
            Some(pg),
            sub_id,
            &url,
            alert_id,
            event_id.unwrap_or(alert_id),
            &rendered.body,
            rendered.sign,
        )
        .await
        {
            Ok(_) => {
                if let Err(e) =
                    sqlx::query("UPDATE webhook_dead_letter SET replayed_at = now() WHERE id = $1")
                        .bind(row_id)
                        .execute(pg)
                        .await
                {
                    tracing::warn!(?e, %row_id, "could not stamp replayed_at; the row may be re-sent");
                }
                metrics::counter!("pegana_dispatcher_deferred_replayed_total").increment(1);
                sent += 1;
            }
            Err(e) if e.is_permanent_rejection() => {
                // A payload the receiver will never accept: count it, give it
                // up after a few rejections, and keep going.
                let give_up = attempts + 1 >= MAX_REPLAY_REJECTIONS;
                if let Err(db) = sqlx::query(
                    "UPDATE webhook_dead_letter \
                        SET replay_attempts = replay_attempts + 1, \
                            replay_failed_at = CASE WHEN $2 THEN now() ELSE NULL END \
                      WHERE id = $1",
                )
                .bind(row_id)
                .bind(give_up)
                .execute(pg)
                .await
                {
                    tracing::warn!(?db, %row_id, "could not record replay rejection");
                }
                tracing::warn!(error = %e, %sub_id, %alert_id, give_up, "deferred replay rejected");
                continue;
            }
            Err(e) => {
                tracing::warn!(error = %e, %sub_id, %alert_id, "deferred replay stopped; rest stays queued");
                break;
            }
        }
    }
    sent
}
