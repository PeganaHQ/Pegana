//! ADR-0003 retraction worker.
//!
//! Polls the `retractions` table every 60s. When a row exists with
//! `webhook_refire_count = 0`, fans out a `type: "retraction"` payload to
//! every webhook subscription that previously received a 2xx alert
//! delivery produced by the broken methodology version, then marks the
//! retraction as processed by setting `webhook_refire_count` to the
//! number of notices delivered (`-2` when no subscriber received one, so it is
//! not claimed again; `-1` marks a claim in flight).
//!
//! ## Concurrency model
//!
//! - **Per-poll**: claim AT MOST ONE retraction per tick via atomic
//!   `UPDATE ... RETURNING` (sentinel `-1` = in-progress). Multiple
//!   dispatcher pods can poll concurrently without double-firing:
//!   the SELECT inside the UPDATE uses `FOR UPDATE SKIP LOCKED`, so
//!   only one pod claims any given row.
//! - **Per-retraction fan-out**: subscribers are dispatched IN PARALLEL
//!   via `tokio::spawn` + a shared `Semaphore` (re-used from the alert
//!   webhook fan-out). Serial fan-out would block the worker for hours
//!   (N subs × max retry curve ≈ 2h35m worst case per sub). Parallel
//!   bounds the wall-clock at "longest single sub" instead of "sum of all
//!   subs".
//!
//! ## Crash recovery
//!
//! If a dispatcher dies mid-fanout, the claimed row sits at
//! `webhook_refire_count = -1` forever. Startup runs `reset_inflight()`
//! to flip -1 back to 0, making the row eligible for re-claim. This
//! preserves the at-least-once semantics ADR-0003 mandates — subscribers
//! may receive the retraction twice across a crash, and dedupe via the
//! `x-pegana-event-id` header (alert_id is stable).
//!
//! ## Signing
//!
//! Reuses `webhook::dispatch_one` verbatim. Same HMAC ed25519 keyset signs
//! both alerts and retractions; receivers verify with the same key.

use crate::delivery::DeliveryPool;
use crate::webhook::{dispatch_one, event_id_for, DispatchConfig};
use anyhow::Result;
use pegana_common::webhook_channel::{render_for_channel, ChannelType};
use sqlx::PgPool;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::interval;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

const POLL_INTERVAL: Duration = Duration::from_secs(60);

/// Sentinel for "in-flight": some pod has claimed this retraction and is
/// currently fanning out. Distinct from 0 (untouched), > 0 (processed) and
/// `PROCESSED_NO_SUBSCRIBERS`.
const INFLIGHT_SENTINEL: i32 = -1;
/// Processed with zero matching subscribers. Distinct from `0` (pending) so a
/// retraction nobody received is not claimed again every poll.
const PROCESSED_NO_SUBSCRIBERS: i32 = -2;

/// Spawn the retraction worker as a tokio task. Returns immediately; the task
/// lives for the duration of the dispatcher process. Takes the shared
/// `webhook_sem` so a retraction storm cannot exhaust the HTTP pool out from
/// under live alerts.
pub fn spawn(pg: PgPool, cfg: Arc<DispatchConfig>, webhook_sem: Arc<DeliveryPool>) {
    tokio::spawn(async move {
        // Crash recovery: reset any in-flight sentinels from a previous
        // process. Safe even with concurrent pods because we're idempotent
        // (re-running the reset just no-ops if no rows are at -1).
        if let Err(e) = reset_inflight(&pg).await {
            warn!(?e, "retraction worker startup reset failed (continuing)");
        }
        let mut tick = interval(POLL_INTERVAL);
        // burn the immediate first tick so we don't race startup
        tick.tick().await;
        loop {
            tick.tick().await;
            if let Err(e) = poll_once(&pg, cfg.clone(), webhook_sem.clone()).await {
                error!(?e, "retraction worker poll failed (will retry next tick)");
            }
        }
    });
}

/// At startup, flip any in-flight sentinels back to 0 so a crashed pod
/// doesn't leave retractions stuck forever. Safe under concurrent pods —
/// a still-running pod would re-claim the row atomically anyway.
pub async fn reset_inflight(pg: &PgPool) -> Result<()> {
    let affected = sqlx::query(
        "UPDATE retractions SET webhook_refire_count = 0 WHERE webhook_refire_count = $1",
    )
    .bind(INFLIGHT_SENTINEL)
    .execute(pg)
    .await?
    .rows_affected();
    if affected > 0 {
        info!(
            rows = affected,
            "retraction worker reset stale in-flight rows from previous process"
        );
    }
    Ok(())
}

/// Single poll cycle. Public so an out-of-band runbook command (or test)
/// can trigger one shot without spawning the background loop.
pub async fn poll_once(
    pg: &PgPool,
    cfg: Arc<DispatchConfig>,
    webhook_sem: Arc<DeliveryPool>,
) -> Result<()> {
    // Atomic claim — single statement, no transaction needed. Combines:
    //   1. SELECT one candidate (oldest first, skip rows another pod is
    //      already processing) via FOR UPDATE SKIP LOCKED
    //   2. UPDATE the row to the in-flight sentinel so no other pod (or
    //      this pod on the next tick) re-claims it
    //   3. RETURN the fan-out inputs
    // The window between this UPDATE and the final completion UPDATE is
    // protected by the sentinel; SELECT predicate `= 0` skips both
    // in-flight (-1) and processed (> 0) rows.
    let claimed: Option<(String, String, Option<String>)> = sqlx::query_as(
        "UPDATE retractions \
            SET webhook_refire_count = $1 \
          WHERE methodology_version = ( \
              SELECT methodology_version FROM retractions \
              WHERE webhook_refire_count = 0 \
              ORDER BY retracted_at ASC \
              LIMIT 1 \
              FOR UPDATE SKIP LOCKED \
          ) \
          RETURNING methodology_version, reason, fix_url",
    )
    .bind(INFLIGHT_SENTINEL)
    .fetch_optional(pg)
    .await?;

    let Some((version, reason, fix_url)) = claimed else {
        // No pending retractions (or another pod claimed them all).
        return Ok(());
    };

    info!(
        version,
        reason, "processing retraction (claimed atomically)"
    );
    let webhook_count = fan_out_retraction(
        pg,
        cfg.clone(),
        webhook_sem,
        &version,
        &reason,
        fix_url.as_deref(),
    )
    .await?;

    // Mark processed even if some sub failed — ADR-0003 retractions are
    // at-least-once, additive. /audit/[id] banner + on-chain memo are the
    // durable record for any sub that was offline.
    sqlx::query(
        "UPDATE retractions \
            SET webhook_refire_count = $1 \
          WHERE methodology_version = $2",
    )
    .bind(if webhook_count == 0 {
        PROCESSED_NO_SUBSCRIBERS
    } else {
        webhook_count as i32
    })
    .bind(&version)
    .execute(pg)
    .await?;
    metrics::counter!(
        "pegana_retraction_dispatched_total",
        "version" => version.clone(),
    )
    .increment(1);
    metrics::histogram!(
        "pegana_retraction_subscribers_per_version",
        "version" => version.clone(),
    )
    .record(webhook_count as f64);
    info!(
        version,
        fired_webhooks = webhook_count,
        "retraction fan-out complete"
    );
    Ok(())
}

async fn fan_out_retraction(
    pg: &PgPool,
    cfg: Arc<DispatchConfig>,
    sem: Arc<DeliveryPool>,
    broken_version: &str,
    reason: &str,
    fix_url: Option<&str>,
) -> Result<usize> {
    // Find every (subscription_id, alert_id) pair where the subscription
    // received a successful 2xx delivery of an alert produced by the
    // broken methodology version. DISTINCT collapses multi-attempt retries
    // (one alert may have N rows in webhook_deliveries; we want one
    // retraction per (sub, alert)).
    //
    // Column names (verified against the live schema):
    //   webhook_deliveries.http_status  (NOT response_status)
    //   webhook_subscriptions.url       (NOT endpoint_url)
    //   webhook_subscriptions.is_active (matches)
    // Migration 0038 adds an index on webhook_deliveries.alert_id so this
    // JOIN doesn't degrade to seq scan as the deliveries table grows.
    let affected: Vec<(Uuid, Uuid, String, String)> = sqlx::query_as(
        "SELECT DISTINCT wd.subscription_id, wd.alert_id, ws.url, ws.channel_type \
         FROM webhook_deliveries wd \
         JOIN alert_evidence ae ON ae.alert_id = wd.alert_id \
         JOIN webhook_subscriptions ws ON ws.id = wd.subscription_id \
         WHERE ae.methodology_version = $1 \
           AND wd.http_status BETWEEN 200 AND 299 \
           AND ws.is_active = TRUE",
    )
    .bind(broken_version)
    .fetch_all(pg)
    .await?;

    if affected.is_empty() {
        debug!(broken_version, "no 2xx-delivered alerts to retract");
        return Ok(0);
    }

    // Anchor the retraction notice at the live `#lifecycle` section, which
    // renders the broken-version banner. The old `#{version}-broken` id was
    // never defined on the page, so the link silently dropped subscribers at
    // the page top (B-006 follow-up; matches api-rs methodology fix_url).
    let evidence_url = Arc::new(format!("{}/methodology#lifecycle", cfg.audit_base_url));
    let reason: Arc<str> = Arc::from(reason);
    let fix_url: Option<Arc<str>> = fix_url.map(Arc::from);
    let broken_version: Arc<str> = Arc::from(broken_version);

    // Parallel fan-out via tokio::spawn + the shared webhook semaphore.
    // Serial dispatch would block the worker for N × dispatch_one's full
    // retry curve (worst case ~2h35m per sub); parallel bounds wall-clock
    // at the slowest single dispatch. The semaphore enforces the same
    // 50-permit cap the alert path uses, so a retraction storm can't
    // exhaust the HTTP pool out from under live alerts.
    // One task per subscription delivering its alerts in order: a slow or
    // paused subscriber ties up one background slot, not one per alert.
    let mut by_sub: std::collections::BTreeMap<Uuid, (String, String, Vec<Uuid>)> =
        std::collections::BTreeMap::new();
    for (sub_id, alert_id, url, channel_type) in affected {
        by_sub
            .entry(sub_id)
            .or_insert_with(|| (url, channel_type, Vec::new()))
            .2
            .push(alert_id);
    }
    let mut handles: Vec<tokio::sync::oneshot::Receiver<usize>> = Vec::new();
    for (sub_id, (url, channel_type, alert_ids)) in by_sub {
        let cfg = cfg.clone();
        let pg = pg.clone();
        let evidence_url = evidence_url.clone();
        let reason = reason.clone();
        let fix_url = fix_url.clone();
        let broken_version = broken_version.clone();
        // Bounded: waits for a background slot instead of growing without limit.
        handles.push(
            sem.spawn_result(async move {
                let mut fired = 0usize;
                for alert_id in alert_ids {
                    let canonical = serde_json::json!({
                        "type": "retraction",
                        "original_alert_id": alert_id,
                        "original_methodology_version": broken_version.as_ref(),
                        "retraction_reason": reason.as_ref(),
                        "retraction_evidence_url": evidence_url.as_ref(),
                        "fix_url": fix_url.as_deref(),
                        // alert_id surfaced at the top level too so receivers
                        // can dedupe via the same header path as for alerts.
                        "alert_id": alert_id,
                    });
                    let ch = ChannelType::from_str(&channel_type).unwrap_or_default();
                    let rendered = render_for_channel(ch, &canonical);
                    let event_id =
                        event_id_for(alert_id, &format!("retraction:{}", broken_version.as_ref()));
                    match dispatch_one(
                        &cfg,
                        Some(&pg),
                        sub_id,
                        &url,
                        alert_id,
                        event_id,
                        &rendered.body,
                        rendered.sign,
                    )
                    .await
                    {
                        Ok(_) => {
                            fired += 1;
                            crate::replay::kick(&pg, &cfg, sub_id).await;
                        }
                        Err(e) => {
                            warn!(
                                error = %e,
                                %sub_id,
                                %alert_id,
                                "retraction dispatch failed (continuing fan-out)"
                            );
                            // A paused subscriber gets the retraction replayed
                            // on recovery, under the same event id.
                            if e.is_deferral() {
                                let _ = crate::webhook_queries::record_dead_letter(
                                    &pg,
                                    sub_id,
                                    alert_id,
                                    canonical,
                                    &e.to_string(),
                                    e.attempts() as i16,
                                    Some(event_id),
                                )
                                .await;
                            }
                        }
                    }
                }
                fired
            })
            .await,
        );
    }

    // Collect outcomes: the number of retraction notices actually delivered.
    let mut fired = 0usize;
    for handle in handles {
        match handle.await {
            Ok(n) => fired += n,
            Err(e) => warn!(?e, "retraction dispatch task ended without a result"),
        }
    }
    Ok(fired)
}
