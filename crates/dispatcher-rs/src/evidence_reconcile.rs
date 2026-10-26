//! ADR-0006 evidence-reconcile subscriber.
//!
//! The engine's `alert_evidence` reconcile worker
//! (`engine-rs/src/evidence_reconcile.rs`) promotes a row out of
//! `alert_evidence_pending` once its synchronous INSERT finally lands, then
//! PUBLISHes `{"event":"evidence_now_available","alert_id":<uuid>}` on the
//! `pegana:evidence_reconciled` channel. Until now nothing subscribed, so the
//! audit link the original subscribers were promised ("evidence is still
//! materializing") never got re-fired once it went live.
//!
//! This worker closes that loop. It subscribes to the channel and, on each
//! message, re-fires an `evidence_now_available` notification to **the same
//! webhook subscriptions that received the original alert**
//! (`webhook_deliveries`), reusing the alert path's fan-out plumbing:
//! [`crate::webhook::dispatch_one`] with the same HMAC keyset, retry curve,
//! and `webhook_deliveries` audit log.
//!
//! ## Why pub/sub (not the XREADGROUP stream)
//!
//! The reconcile signal is best-effort and idempotent on the receiving end:
//! the audit row is already durable when it fires, receivers dedupe on the
//! stable `x-pegana-event-id` header, and a missed signal simply means
//! the web/API serves the receipt on the next poll. A fire-and-forget pub/sub
//! fits that contract — we don't need at-least-once stream semantics or a
//! consumer group. It also keeps the hot alert-consumption loop in `main.rs`
//! completely untouched: this runs on its own dedicated pub/sub connection.

use crate::delivery::DeliveryPool;
use crate::webhook::{dispatch_one, event_id_for, DispatchConfig};
use anyhow::{Context, Result};
use futures::StreamExt;
use pegana_common::webhook_channel::{render_for_channel, ChannelType};
use sqlx::PgPool;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Spawn the evidence-reconcile subscriber as a tokio task. Returns
/// immediately; the task lives for the duration of the dispatcher process and
/// auto-reconnects if the pub/sub connection drops. Runs on its OWN redis
/// connection (via the `Client`) so it never contends with the alert loop's
/// `ConnectionManager`.
pub fn spawn(
    pg: PgPool,
    cfg: Arc<DispatchConfig>,
    webhook_sem: Arc<DeliveryPool>,
    redis_client: redis::Client,
) {
    tokio::spawn(async move {
        loop {
            if let Err(e) = run(&pg, &cfg, &webhook_sem, &redis_client).await {
                // A dropped pub/sub connection (redis restart, network blip)
                // surfaces here. Log, back off, and re-subscribe — losing the
                // subscription silently would re-open the exact gap this
                // worker closes.
                warn!(
                    ?e,
                    "evidence-reconcile subscriber dropped; reconnecting in 5s"
                );
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    });
}

/// Subscribe and consume forever. Returns `Err` only when the connection /
/// stream ends, so [`spawn`]'s outer loop can re-subscribe.
async fn run(
    pg: &PgPool,
    cfg: &Arc<DispatchConfig>,
    webhook_sem: &Arc<DeliveryPool>,
    redis_client: &redis::Client,
) -> Result<()> {
    let mut pubsub = redis_client
        .get_async_pubsub()
        .await
        .context("open evidence-reconcile pub/sub connection")?;
    pubsub
        .subscribe(pegana_common::channels::EVIDENCE_RECONCILED)
        .await
        .context("subscribe to evidence_reconciled channel")?;
    info!(
        channel = pegana_common::channels::EVIDENCE_RECONCILED,
        "evidence-reconcile subscriber ready"
    );

    let mut stream = pubsub.on_message();
    while let Some(msg) = stream.next().await {
        let payload: String = match msg.get_payload() {
            Ok(p) => p,
            Err(e) => {
                warn!(
                    ?e,
                    "evidence_reconciled message has non-string payload; skipping"
                );
                continue;
            }
        };
        let evt: pegana_common::EvidenceReconciledEvent = match serde_json::from_str(&payload) {
            Ok(e) => e,
            Err(e) => {
                warn!(
                    ?e,
                    payload, "malformed evidence_reconciled payload; skipping"
                );
                continue;
            }
        };
        if evt.event != "evidence_now_available" {
            debug!(
                event = evt.event,
                "ignoring unrecognized evidence_reconciled event"
            );
            continue;
        }
        metrics::counter!("pegana_dispatcher_evidence_reconciled_received_total").increment(1);
        if let Err(e) = handle(pg, cfg.clone(), webhook_sem.clone(), evt.alert_id).await {
            // Non-fatal: the audit row is already live. Log and keep consuming.
            error!(?e, alert_id = %evt.alert_id, "evidence-reconcile fan-out failed");
        }
    }

    // Stream ended → connection closed. Bubble up so spawn() reconnects.
    anyhow::bail!("evidence_reconciled pub/sub stream ended")
}

/// Fan out the `evidence_now_available` notification for one reconciled alert
/// to every channel that received the original alert.
async fn handle(
    pg: &PgPool,
    cfg: Arc<DispatchConfig>,
    webhook_sem: Arc<DeliveryPool>,
    alert_id: Uuid,
) -> Result<()> {
    // The pub/sub message is only a hint: signed "ready" webhooks go out only
    // when the receipt actually exists.
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM alert_evidence WHERE alert_id = $1)")
            .bind(alert_id)
            .fetch_one(pg)
            .await
            .context("evidence-reconcile receipt existence check")?;
    if !exists {
        warn!(%alert_id, "evidence_reconciled for an alert with no receipt; skipping re-fire");
        metrics::counter!("pegana_dispatcher_evidence_reconciled_no_receipt_total").increment(1);
        return Ok(());
    }
    let evidence_url = format!("{}/audit/{}", cfg.audit_base_url, alert_id);
    let webhook_count = fan_out_webhooks(pg, cfg, webhook_sem, alert_id, &evidence_url).await?;
    info!(
        %alert_id,
        fired_webhooks = webhook_count,
        "evidence_now_available re-fire complete"
    );
    metrics::histogram!("pegana_dispatcher_evidence_reconciled_webhooks")
        .record(webhook_count as f64);
    Ok(())
}

/// Re-fire an `evidence_now_available` webhook to every webhook subscription
/// that received this alert. Reuses `dispatch_one` verbatim (same keyset,
/// retry curve, and `webhook_deliveries` audit trail as the alert path). The
/// `(sub, url)` set mirrors `retraction::fan_out_retraction`, keyed on a
/// single `alert_id`.
async fn fan_out_webhooks(
    pg: &PgPool,
    cfg: Arc<DispatchConfig>,
    sem: Arc<DeliveryPool>,
    alert_id: Uuid,
    evidence_url: &str,
) -> Result<usize> {
    let affected: Vec<(Uuid, String, String)> = sqlx::query_as(
        "SELECT DISTINCT wd.subscription_id, ws.url, ws.channel_type \
         FROM webhook_deliveries wd \
         JOIN webhook_subscriptions ws ON ws.id = wd.subscription_id \
         WHERE wd.alert_id = $1 \
           AND wd.http_status BETWEEN 200 AND 299 \
           AND ws.is_active = TRUE",
    )
    .bind(alert_id)
    .fetch_all(pg)
    .await
    .context("evidence-reconcile webhook fan-out query")?;

    if affected.is_empty() {
        debug!(%alert_id, "no webhook subscribers to re-fire evidence to");
        return Ok(0);
    }

    let evidence_url = Arc::new(evidence_url.to_string());

    let mut handles: Vec<tokio::sync::oneshot::Receiver<Option<u16>>> = Vec::new();
    for (sub_id, url, channel_type) in affected {
        let cfg = cfg.clone();
        let pg = pg.clone();
        let evidence_url = evidence_url.clone();
        let sem = sem.clone();
        // Bounded: waits for a delivery slot instead of growing without limit.
        handles.push(
            sem.spawn_result(async move {
                let canonical = serde_json::json!({
                    "type": "evidence_now_available",
                    "alert_id": alert_id,
                    "evidence_url": evidence_url.as_ref(),
                    // The whole point of this re-fire: the audit row is now live.
                    "evidence_status": "ready",
                });
                let ch = ChannelType::from_str(&channel_type).unwrap_or_default();
                let rendered = render_for_channel(ch, &canonical);
                match dispatch_one(
                    &cfg,
                    Some(&pg),
                    sub_id,
                    &url,
                    alert_id,
                    event_id_for(alert_id, "evidence:1"),
                    &rendered.body,
                    rendered.sign,
                )
                .await
                {
                    Ok(status) => {
                        crate::replay::kick(&pg, &cfg, sub_id).await;
                        Some(status)
                    }
                    Err(e) => {
                        warn!(
                            error = %e,
                            %sub_id,
                            %alert_id,
                            "evidence-reconcile webhook dispatch failed (continuing fan-out)"
                        );
                        // A paused subscriber (breaker open / backlog) gets the
                        // follow-up replayed on recovery, under its own event id.
                        if e.is_deferral() {
                            let _ = crate::webhook_queries::record_dead_letter(
                                &pg,
                                sub_id,
                                alert_id,
                                canonical,
                                &e.to_string(),
                                e.attempts() as i16,
                                Some(event_id_for(alert_id, "evidence:1")),
                            )
                            .await;
                        }
                        None
                    }
                }
            })
            .await,
        );
    }

    let mut fired = 0usize;
    for handle in handles {
        match handle.await {
            Ok(Some(_status)) => fired += 1,
            Ok(None) => {}
            Err(e) => warn!(?e, "evidence-reconcile webhook task panicked"),
        }
    }
    Ok(fired)
}
