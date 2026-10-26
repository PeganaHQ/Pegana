//! ADR-0006 background reconcile worker for `alert_evidence_pending`.
//!
//! When `push_alert`'s synchronous INSERT into `alert_evidence` fails (DB
//! deadlock, disk pressure, etc.), the engine drops the would-be audit row
//! into `alert_evidence_pending` so the alert dispatch itself never aborts
//! (business rule #10: deliver the alert > persist evidence). This worker is
//! the recovery half of that contract.
//!
//! Every 30s it scans for eligible pending rows and re-attempts the
//! `alert_evidence` INSERT. On success the pending row is deleted and a
//! `evidence_now_available` event is published to Redis so the dispatcher can
//! re-fire the audit link to the subscribers that received the original alert.
//! If the recovered row owed an on-chain commit (`commit_status='pending'`), it
//! is also handed to the dead-letter retry worker (its original commit task died
//! FK-failing against the then-missing evidence row), so it is never stranded.
//! After 24h with no success the row is marked `failed_permanently_at`, which
//! flips the webhook `evidence_status` to `failed_permanent` and makes
//! `GET /v1/audit/:id` return the coded `410 Gone` (previously unreachable).
//!
//! The per-tick logic lives in [`reconcile_once`] so tests can drive a single
//! pass without the infinite loop.

use anyhow::{Context, Result};
use sqlx::PgPool;
use std::time::Duration;
use tracing::{error, info, warn};
use uuid::Uuid;

/// Cadence of the reconcile loop (ADR-0006: "runs every 30 seconds").
const RECONCILE_INTERVAL: Duration = Duration::from_secs(30);

/// Redis pub/sub channel the worker emits a reconcile event on after a pending
/// row is successfully promoted to `alert_evidence`. The dispatcher subscribes
/// (`dispatcher-rs/src/evidence_reconcile.rs`) and re-fires
/// `evidence_now_available` to the original subscribers (ADR-0006). Aliases the
/// shared `pegana_common::channels::EVIDENCE_RECONCILED` so the publisher and
/// the subscriber can never drift apart.
pub const EVIDENCE_RECONCILED_CHANNEL: &str = pegana_common::channels::EVIDENCE_RECONCILED;

/// After this long in the queue without a successful INSERT, the row is marked
/// `failed_permanently_at` and Rafael is paged (ADR-0006 default; adjustable).
const FAILED_PERMANENT_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

/// One eligible pending row, decoded from `alert_evidence_pending`:
/// `(alert_id, payload, aged_out)`. `aged_out` is the 24h permanent-failure
/// gate, computed in SQL against `queued_at`.
type PendingRow = (Uuid, sqlx::types::Json<serde_json::Value>, bool);

/// Counters for one reconcile pass — handy for tests + the periodic log line.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ReconcileStats {
    pub scanned: usize,
    pub recovered: usize,
    pub failed_again: usize,
    pub failed_permanent: usize,
}

/// Long-lived task: re-attempts pending `alert_evidence` INSERTs every 30s.
///
/// Only needs the `PgPool` (no keypair / RPC), so it is spawned unconditionally
/// from `main` regardless of whether on-chain commit is enabled. `redis` is an
/// optional publisher used to emit the reconcile event; pass `None` to skip
/// publishing (e.g. if no publisher connection is available).
pub async fn run_alert_evidence_reconcile(
    pool: PgPool,
    mut redis: Option<redis::aio::ConnectionManager>,
) {
    let mut ticker = tokio::time::interval(RECONCILE_INTERVAL);
    // Eat the immediate first tick so we don't double-scan at startup alongside
    // the snapshot-hydration path; the queue is rarely non-empty at boot.
    ticker.tick().await;
    loop {
        ticker.tick().await;
        match reconcile_once(&pool, redis.as_mut()).await {
            Ok(stats) => {
                if stats.recovered > 0 || stats.failed_permanent > 0 {
                    info!(
                        scanned = stats.scanned,
                        recovered = stats.recovered,
                        failed_again = stats.failed_again,
                        failed_permanent = stats.failed_permanent,
                        "alert_evidence reconcile pass"
                    );
                }
            }
            Err(e) => {
                warn!(
                    ?e,
                    "alert_evidence reconcile pass failed (will retry next tick)"
                );
                metrics::counter!("pegana_evidence_reconcile_pass_failed_total").increment(1);
            }
        }
    }
}

/// Single reconcile pass — extracted from the loop so tests can run exactly one
/// tick. Scans every eligible pending row (`failed_permanently_at IS NULL AND
/// last_attempted_at < NOW() - 30s`) and, for each:
///   * if it is older than 24h → mark `failed_permanently_at` + page;
///   * else attempt the `alert_evidence` INSERT, deleting the pending row +
///     publishing the reconcile event on success, or bumping
///     `attempts`/`last_error`/`last_attempted_at` on failure.
pub async fn reconcile_once(
    pool: &PgPool,
    mut redis: Option<&mut redis::aio::ConnectionManager>,
) -> Result<ReconcileStats> {
    // Eligibility mirrors idx_pending_eligible. The 30s `last_attempted_at`
    // gate matches the loop cadence so a row touched this tick is not retried
    // again immediately. `aged_out` is computed in SQL against queued_at so the
    // 24h cutoff uses the DB clock (not the engine host clock).
    let rows: Vec<PendingRow> = sqlx::query_as(
        "SELECT alert_id, payload, \
                (NOW() - queued_at) > $1 AS aged_out \
           FROM alert_evidence_pending \
          WHERE failed_permanently_at IS NULL \
            AND last_attempted_at < NOW() - INTERVAL '30 seconds'",
    )
    .bind(pg_interval(FAILED_PERMANENT_AFTER))
    .fetch_all(pool)
    .await
    .context("scan alert_evidence_pending")?;

    let mut stats = ReconcileStats {
        scanned: rows.len(),
        ..Default::default()
    };

    for (alert_id, payload, aged_out) in rows {
        if aged_out {
            mark_failed_permanent(pool, alert_id).await?;
            stats.failed_permanent += 1;
            continue;
        }
        match insert_from_payload(pool, alert_id, &payload.0).await {
            Ok(needs_commit) => {
                // Promotion succeeded — drop the pending row and notify.
                if let Err(e) = delete_pending(pool, alert_id).await {
                    // The audit row is in place; a stale pending row only risks
                    // the API briefly returning 202 instead of 200 until the
                    // next pass deletes it. Log, don't fail the whole pass.
                    warn!(?e, %alert_id, "reconcile: delete pending row failed");
                }
                if needs_commit {
                    // Recovered at commit_status='pending' but its original commit
                    // task is dead — hand it to the dead-letter retry worker so it
                    // is committed or honestly terminal'd, never stranded.
                    if let Err(e) = seed_commit_retry(pool, alert_id).await {
                        warn!(?e, %alert_id, "reconcile: failed to seed commit-retry row");
                    }
                }
                publish_reconciled(redis.as_deref_mut(), alert_id).await;
                stats.recovered += 1;
                metrics::counter!("pegana_evidence_reconcile_total", "outcome" => "recovered")
                    .increment(1);
            }
            Err(e) => {
                bump_attempt(pool, alert_id, &format!("{e:?}")).await?;
                stats.failed_again += 1;
                metrics::counter!("pegana_evidence_reconcile_total", "outcome" => "failed_again")
                    .increment(1);
            }
        }
    }

    Ok(stats)
}

/// Promote a pending payload into `alert_evidence`. The payload is the
/// schema-versioned envelope `push_alert` writes:
/// `{"schema": 1, "payload": { <alert_evidence columns> }}`. We unwrap the
/// envelope, extract the columns per the migration 0028/0033 schema, and INSERT
/// (`ON CONFLICT DO NOTHING` so a concurrent recovery is idempotent).
/// Returns `true` when the promoted row is `commit_status='pending'` — i.e. it
/// still owes an on-chain commit whose original task already died, so the caller
/// must hand it to the dead-letter retry worker (see [`seed_commit_retry`]).
async fn insert_from_payload(
    pool: &PgPool,
    alert_id: Uuid,
    envelope: &serde_json::Value,
) -> Result<bool> {
    // Accept both the wrapped envelope (current writer) and a bare payload
    // (defensive — older/hand-seeded rows). schema != 1 is abandoned loudly so
    // we don't loop forever on a shape we cannot map (Note 2 in wave-3b notes).
    let inner = if let Some(p) = envelope.get("payload") {
        if let Some(schema) = envelope.get("schema").and_then(|s| s.as_u64()) {
            if schema != 1 {
                anyhow::bail!("unsupported pending payload schema {schema}");
            }
        }
        p
    } else {
        envelope
    };

    let methodology_version = inner
        .get("methodology_version")
        .and_then(|v| v.as_str())
        .context("payload missing methodology_version")?;
    let methodology_git_sha = inner.get("methodology_git_sha").and_then(|v| v.as_str());
    let assets_toml_sha256 = inner
        .get("assets_toml_sha256")
        .and_then(|v| v.as_str())
        .context("payload missing assets_toml_sha256")?;
    let receipt_sha256 = inner
        .get("receipt_sha256")
        .and_then(|v| v.as_str())
        .context("payload missing receipt_sha256")?;
    let commit_status = inner
        .get("commit_status")
        .and_then(|v| v.as_str())
        .unwrap_or("not_applicable");
    // inputs_frozen + computed are NOT NULL JSONB; replay_artifact is nullable.
    let inputs_frozen = inner
        .get("inputs_frozen")
        .cloned()
        .context("payload missing inputs_frozen")?;
    let computed = inner
        .get("computed")
        .cloned()
        .context("payload missing computed")?;
    let replay_artifact = inner
        .get("replay_artifact")
        .filter(|v| !v.is_null())
        .cloned();

    sqlx::query(
        r#"INSERT INTO alert_evidence
               (alert_id, methodology_version, methodology_git_sha, assets_toml_sha256,
                inputs_frozen, computed, replay_artifact, receipt_sha256, commit_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (alert_id) DO NOTHING"#,
    )
    .bind(alert_id)
    .bind(methodology_version)
    .bind(methodology_git_sha)
    .bind(assets_toml_sha256)
    .bind(inputs_frozen)
    .bind(computed)
    .bind(replay_artifact)
    .bind(receipt_sha256)
    .bind(commit_status)
    .execute(pool)
    .await
    .context("reconcile INSERT into alert_evidence")?;
    Ok(commit_status == "pending")
}

/// A recovered row whose payload was `commit_status='pending'` now has an audit
/// row, but its ORIGINAL on-chain commit task already died — it FK-failed when
/// it tried to `record_commit_failure` against the not-yet-existing evidence row
/// (onchain_commit.rs), so nothing will ever retry or terminal-flip it. Seed an
/// `alert_evidence_commit_failures` row so `run_commit_failures_retry` adopts it
/// and either lands the commit (it reads methodology_version/receipt_sha256 off
/// the now-present evidence row) or flips it to a terminal status — closing the
/// "stranded at pending forever" gap. `last_attempted_at` is backdated 1h so the
/// retry worker picks it up on its next tick; idempotent via the alert_id PK.
async fn seed_commit_retry(pool: &PgPool, alert_id: Uuid) -> Result<()> {
    sqlx::query(
        "INSERT INTO alert_evidence_commit_failures \
                (alert_id, first_failed_at, last_attempted_at, attempts, last_error, error_kind) \
         VALUES ($1, NOW(), NOW() - INTERVAL '1 hour', 0, \
                 'recovered from alert_evidence_pending; on-chain commit never landed', 'rpc') \
         ON CONFLICT (alert_id) DO NOTHING",
    )
    .bind(alert_id)
    .execute(pool)
    .await
    .context("seed commit-retry row for recovered pending alert")?;
    Ok(())
}

/// Delete the pending row once its audit row is in `alert_evidence`.
async fn delete_pending(pool: &PgPool, alert_id: Uuid) -> Result<()> {
    sqlx::query("DELETE FROM alert_evidence_pending WHERE alert_id = $1")
        .bind(alert_id)
        .execute(pool)
        .await
        .context("delete reconciled pending row")?;
    Ok(())
}

/// Failure path for a single row: bump attempts/last_error/last_attempted_at so
/// the eligibility gate defers it 30s and the count is visible to operators.
async fn bump_attempt(pool: &PgPool, alert_id: Uuid, last_error: &str) -> Result<()> {
    sqlx::query(
        "UPDATE alert_evidence_pending \
            SET attempts = attempts + 1, \
                last_attempted_at = NOW(), \
                last_error = $2 \
          WHERE alert_id = $1",
    )
    .bind(alert_id)
    .bind(last_error)
    .execute(pool)
    .await
    .context("bump alert_evidence_pending attempt")?;
    Ok(())
}

/// 24h cutoff: mark the row permanently failed (drives the API 410) and page.
async fn mark_failed_permanent(pool: &PgPool, alert_id: Uuid) -> Result<()> {
    sqlx::query(
        "UPDATE alert_evidence_pending \
            SET failed_permanently_at = NOW(), \
                last_attempted_at = NOW(), \
                attempts = attempts + 1 \
          WHERE alert_id = $1 AND failed_permanently_at IS NULL",
    )
    .bind(alert_id)
    .execute(pool)
    .await
    .context("mark alert_evidence_pending failed_permanently")?;

    error!(
        %alert_id,
        "alert_evidence reconcile gave up after 24h — audit row will never \
         materialise (GET /v1/audit/:id now returns 410)"
    );
    sentry::capture_message(
        &format!("pegana alert_evidence reconcile failed_permanent: alert {alert_id}"),
        sentry::Level::Error,
    );
    metrics::counter!("pegana_evidence_reconcile_total", "outcome" => "failed_permanent")
        .increment(1);
    Ok(())
}

/// Publish the reconcile event so the dispatcher can re-fire the now-live audit
/// link (ADR-0006 `evidence_now_available`).
///
/// The consumer lives in `dispatcher-rs/src/evidence_reconcile.rs`: it
/// subscribes to `EVIDENCE_RECONCILED_CHANNEL`, looks up every Telegram chat /
/// webhook subscription that received the original alert, and re-fires the
/// `evidence_now_available` notification carrying the now-live audit link. If
/// no dispatcher is listening the publish is harmless (no subscriber → zero
/// deliveries) and the audit row is already durable.
async fn publish_reconciled(redis: Option<&mut redis::aio::ConnectionManager>, alert_id: Uuid) {
    let Some(conn) = redis else { return };
    use redis::AsyncCommands;
    // Serialize the SHARED cross-crate contract type (byte-identical wire format
    // to the previous ad-hoc json!: `{"event":…,"alert_id":…}`) so the engine's
    // publish and the dispatcher's parse can no longer drift apart silently.
    let payload = serde_json::to_string(&pegana_common::EvidenceReconciledEvent {
        event: "evidence_now_available".to_string(),
        alert_id,
    })
    .unwrap_or_default();
    let published: redis::RedisResult<redis::Value> =
        conn.publish(EVIDENCE_RECONCILED_CHANNEL, payload).await;
    match published {
        Ok(_) => {
            metrics::counter!("pegana_engine_publishes_total", "kind" => "evidence_reconciled")
                .increment(1);
        }
        Err(e) => {
            // Non-fatal: the audit row is already live; only the re-fire signal
            // is lost. The API/web will serve the receipt on the next poll.
            warn!(?e, %alert_id, "reconcile event publish failed (audit row already live)");
        }
    }
}

/// Render a `Duration` as a Postgres `INTERVAL` literal (whole seconds).
fn pg_interval(d: Duration) -> sqlx::postgres::types::PgInterval {
    sqlx::postgres::types::PgInterval {
        months: 0,
        days: 0,
        microseconds: (d.as_secs() as i64) * 1_000_000,
    }
}
