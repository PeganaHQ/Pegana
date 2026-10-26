//! Anchor receipt sha256 on-chain via Solana SPL Memo program.
//!
//! Fire-and-forget — failures are logged + counted, never block alert dispatch.
//!
//! ## ADR-0004 enhancements over the base spec in `06-engine-changes.md`:
//!
//! - **Retry**: RPC failure → 3 attempts with 1s/5s/15s backoff. Blockhash
//!   expired → re-fetch + retry immediately (up to 2x). InsufficientFundsForFee
//!   → NO retry (commit_status='wallet_drained' + Sentry).
//! - **Burst control**: a `tokio::sync::Semaphore(5)` inside `CommitContext`
//!   caps in-flight commits. A depeg-event burst (50+ alerts in 10min) queues
//!   rather than DoS-ing the RPC quota.
//! - **Recurring wallet alarm**: `run_wallet_balance_monitor` ticks every 5min
//!   and emits gauges + tiered warn/error logs (not only at startup).
//! - **State machine**: terminal UPDATEs gate on `WHERE commit_status='pending'`
//!   so we never accidentally overwrite an already-terminal row.

use anyhow::{Context, Result};
use solana_rpc_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig, signature::Keypair, signer::Signer,
    transaction::Transaction,
};
use solana_transaction_error::TransactionError;
use spl_memo::build_memo;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

const MEMO_FORMAT: &str = "pegana-v1";
const COMMIT_TIMEOUT: Duration = Duration::from_secs(60);
const RPC_MAX_RETRIES: u32 = 3;
const BLOCKHASH_MAX_RETRIES: u32 = 2;
const RPC_BACKOFF: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(5),
    Duration::from_secs(15),
];

/// Shared context for the on-chain commit pipeline.
///
/// Cloned (via `Arc`) into every spawned commit task. The semaphore caps how
/// many transactions may be in-flight against the RPC endpoint at once — a
/// real depeg event can fire 50+ critical alerts in 10min, and Helius/Triton
/// quotas would otherwise reject the burst.
pub struct CommitContext {
    pub rpc: Arc<RpcClient>,
    pub rpc_fallback: Arc<RpcClient>,
    pub keypair: Arc<Keypair>,
    pub pg: PgPool,
    pub semaphore: Arc<Semaphore>,
}

/// Categorisation used both for the failure table (`error_kind` column) and
/// for branching on the retry policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CommitErrorKind {
    /// Generic RPC/transport error — backoff + retry.
    Rpc,
    /// Recent blockhash expired between fetch and submit — re-fetch + retry.
    Blockhash,
    /// Wallet drained mid-flight — terminal, no retry.
    InsufficientFunds,
    /// Anything else (parse error, signer mismatch, …) — treated like RPC
    /// for retry-policy purposes. Kept distinct so the failure table preserves
    /// a forensic signal that this was not a clean RPC transport error.
    #[allow(dead_code)]
    Other,
}

impl CommitErrorKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Rpc => "rpc",
            Self::Blockhash => "blockhash",
            Self::InsufficientFunds => "insufficient_funds",
            Self::Other => "other",
        }
    }
}

/// The SINGLE source of truth for which verdict states anchor a receipt on-chain
/// (ADR-0004: severe transitions only). Used by BOTH the commit trigger and the
/// `initial_commit_status` stamp in `main.rs`, so the two can never drift — a
/// state stamped `pending` that then never anchors (or vice versa) would be a
/// silent trust hole. (audit 2026-07-18: de-duplicated the two hand-copied gates.)
pub fn is_anchorable(state: pegana_common::PegState) -> bool {
    use pegana_common::PegState;
    matches!(
        state,
        PegState::Depeg | PegState::Critical | PegState::BlackSwan
    )
}

/// Fire-and-forget entry point. Spawns a tokio task and returns immediately —
/// never blocks the caller (alert dispatch is what the user paid for).
pub fn commit_receipt(
    ctx: Arc<CommitContext>,
    alert_id: Uuid,
    methodology_version: String,
    receipt_sha256: String,
) {
    tokio::spawn(async move {
        // Burst control: cap concurrent in-flight commits. `available_permits`
        // is a snapshot, but it is good enough for an instantaneous gauge —
        // we recompute right after we acquire.
        let queue_depth_pre = ctx.semaphore.available_permits();
        metrics::gauge!("pegana_commit_queue_depth")
            .set((ctx.semaphore.available_permits() as f64).max(0.0));
        debug!(
            %alert_id,
            queue_depth_available = queue_depth_pre,
            "commit task queued"
        );

        let permit = match ctx.semaphore.clone().acquire_owned().await {
            Ok(p) => p,
            Err(e) => {
                error!(?e, %alert_id, "commit semaphore closed");
                metrics::counter!(
                    "pegana_onchain_commit_total",
                    "outcome" => "semaphore_closed",
                )
                .increment(1);
                return;
            }
        };
        metrics::gauge!("pegana_commit_queue_depth").set(ctx.semaphore.available_permits() as f64);

        let result = tokio::time::timeout(
            COMMIT_TIMEOUT,
            do_commit_with_retry(ctx.clone(), alert_id, &methodology_version, &receipt_sha256),
        )
        .await;

        // Release permit before persisting so the next queued commit can
        // start; persistence is purely local I/O and does not touch the RPC.
        drop(permit);
        metrics::gauge!("pegana_commit_queue_depth").set(ctx.semaphore.available_permits() as f64);

        match result {
            Ok(Ok(sig)) => {
                if let Err(e) = persist_committed(&ctx.pg, alert_id, &sig).await {
                    error!(?e, %alert_id, "failed to persist onchain_tx_sig");
                    metrics::counter!("pegana_onchain_persist_failed_total").increment(1);
                }
                info!(
                    %alert_id,
                    signature = %sig,
                    "receipt committed on-chain"
                );
                metrics::counter!(
                    "pegana_onchain_commit_total",
                    "outcome" => "ok",
                )
                .increment(1);
            }
            Ok(Err(failure)) => {
                handle_terminal_failure(&ctx, alert_id, failure).await;
            }
            Err(_) => {
                error!(%alert_id, "onchain commit timeout");
                metrics::counter!(
                    "pegana_onchain_commit_total",
                    "outcome" => "timeout",
                )
                .increment(1);
                // Treat timeout as an RPC-class failure so the background
                // retry worker can take another swing at the 24h window.
                if let Err(e) = record_commit_failure(
                    &ctx.pg,
                    alert_id,
                    CommitErrorKind::Rpc,
                    "commit attempt timed out",
                )
                .await
                {
                    error!(?e, %alert_id, "failed to record commit failure (timeout)");
                }
            }
        }
    });
}

/// Terminal failure carries the categorisation so the caller can choose the
/// right `commit_status` update + Sentry behaviour. `Clone` so `run_commit_loop`
/// tests can script a sequence of attempt outcomes.
#[derive(Debug, Clone)]
struct CommitFailure {
    kind: CommitErrorKind,
    message: String,
}

async fn handle_terminal_failure(ctx: &Arc<CommitContext>, alert_id: Uuid, failure: CommitFailure) {
    match failure.kind {
        CommitErrorKind::InsufficientFunds => {
            error!(
                %alert_id,
                err = %failure.message,
                "onchain commit aborted — wallet drained (InsufficientFundsForFee)"
            );
            sentry::capture_message(
                &format!("pegana commit wallet drained: alert {alert_id}"),
                sentry::Level::Error,
            );
            metrics::counter!(
                "pegana_onchain_commit_total",
                "outcome" => "wallet_drained",
            )
            .increment(1);
            if let Err(e) = persist_terminal_status(&ctx.pg, alert_id, "wallet_drained").await {
                error!(?e, %alert_id, "failed to persist commit_status=wallet_drained");
            }
            // Still record into the failure table so ops can see how many
            // alerts hit the dry wallet in this window.
            if let Err(e) = record_commit_failure(
                &ctx.pg,
                alert_id,
                CommitErrorKind::InsufficientFunds,
                &failure.message,
            )
            .await
            {
                error!(?e, %alert_id, "failed to record commit failure (drained)");
            }
        }
        kind => {
            error!(
                %alert_id,
                error_kind = kind.as_str(),
                err = %failure.message,
                "onchain commit hard-failed after retries"
            );
            metrics::counter!(
                "pegana_onchain_commit_total",
                "outcome" => "rpc_error",
            )
            .increment(1);
            if let Err(e) = record_commit_failure(&ctx.pg, alert_id, kind, &failure.message).await {
                error!(?e, %alert_id, "failed to record commit failure (rpc)");
            }
            // Leave commit_status='pending'. The background retry worker
            // (`run_commit_failures_retry`) owns the 24h cycle + the flip to
            // retry_exhausted when the window expires.
        }
    }
}

/// Drives the per-attempt loop. Returns `Ok(signature)` on first success,
/// `Err(CommitFailure)` if every retry is exhausted (or the failure is
/// terminal-by-policy, like InsufficientFundsForFee).
async fn do_commit_with_retry(
    ctx: Arc<CommitContext>,
    alert_id: Uuid,
    methodology_version: &str,
    receipt_sha256: &str,
) -> std::result::Result<String, CommitFailure> {
    let memo_payload = format!(
        "{}|{}|{}|{}",
        MEMO_FORMAT, methodology_version, alert_id, receipt_sha256
    );
    let memo_bytes = memo_payload.into_bytes();

    // The RPC send + the real backoff sleep are INJECTED into the loop so the
    // loop's control flow is unit-testable hermetically (see run_commit_loop).
    run_commit_loop(
        alert_id,
        move |commit_attempt| {
            let ctx = ctx.clone();
            let memo = memo_bytes.clone();
            async move { attempt_commit(&ctx, &memo, commit_attempt).await }
        },
        tokio::time::sleep,
    )
    .await
}

/// The retry-loop CONTROL FLOW, with the per-attempt action (`attempt`) and the
/// backoff `sleep` injected so it can be unit-tested with NO RpcClient and NO
/// real sleeps. Policy (ADR-0004): terminal-on-InsufficientFunds (never retried
/// into a drained wallet); immediate blockhash re-fetch up to `BLOCKHASH_MAX_RETRIES`;
/// exponential RPC backoff over `RPC_BACKOFF` up to `RPC_MAX_RETRIES`. This spends
/// real SOL, so the loop's branching + backoff-array indexing + caps must be
/// exact — hence the direct tests below. (audit 2026-07-18)
async fn run_commit_loop<F, Fut, S, SFut>(
    alert_id: Uuid,
    mut attempt: F,
    mut sleep: S,
) -> std::result::Result<String, CommitFailure>
where
    F: FnMut(u32) -> Fut,
    Fut: std::future::Future<Output = std::result::Result<String, CommitFailure>>,
    S: FnMut(Duration) -> SFut,
    SFut: std::future::Future<Output = ()>,
{
    let mut rpc_attempt: u32 = 0;
    let mut blockhash_attempt: u32 = 0;
    let mut commit_attempt: u32 = 0;

    loop {
        match attempt(commit_attempt).await {
            Ok(sig) => return Ok(sig),
            Err(failure) => match failure.kind {
                CommitErrorKind::InsufficientFunds => {
                    // Terminal — never retry. Caller writes wallet_drained.
                    return Err(failure);
                }
                CommitErrorKind::Blockhash => {
                    if blockhash_attempt >= BLOCKHASH_MAX_RETRIES {
                        warn!(
                            %alert_id,
                            attempts = blockhash_attempt + 1,
                            err = %failure.message,
                            "blockhash retries exhausted"
                        );
                        return Err(failure);
                    }
                    blockhash_attempt += 1;
                    commit_attempt += 1;
                    warn!(
                        %alert_id,
                        attempt = blockhash_attempt,
                        err = %failure.message,
                        "blockhash expired — re-fetching + retrying immediately"
                    );
                    metrics::counter!(
                        "pegana_onchain_commit_retry_total",
                        "reason" => "blockhash",
                    )
                    .increment(1);
                    continue;
                }
                CommitErrorKind::Rpc | CommitErrorKind::Other => {
                    if rpc_attempt as usize >= RPC_BACKOFF.len() || rpc_attempt >= RPC_MAX_RETRIES {
                        warn!(
                            %alert_id,
                            attempts = rpc_attempt,
                            err = %failure.message,
                            "rpc retries exhausted"
                        );
                        return Err(failure);
                    }
                    let backoff = RPC_BACKOFF[rpc_attempt as usize];
                    rpc_attempt += 1;
                    commit_attempt += 1;
                    warn!(
                        %alert_id,
                        attempt = rpc_attempt,
                        backoff_ms = backoff.as_millis() as u64,
                        err = %failure.message,
                        "rpc commit failed — backing off"
                    );
                    metrics::counter!(
                        "pegana_onchain_commit_retry_total",
                        "reason" => "rpc",
                    )
                    .increment(1);
                    sleep(backoff).await;
                    continue;
                }
            },
        }
    }
}

fn rpc_for_attempt<'a, T>(attempt: u32, primary: &'a T, fallback: &'a T) -> &'a T {
    if attempt.is_multiple_of(2) {
        primary
    } else {
        fallback
    }
}

/// One transaction round-trip: fetch blockhash → build → sign → send+confirm.
/// Classifies any failure into a `CommitErrorKind` for the retry loop.
async fn attempt_commit(
    ctx: &Arc<CommitContext>,
    memo_bytes: &[u8],
    commit_attempt: u32,
) -> std::result::Result<String, CommitFailure> {
    let rpc = rpc_for_attempt(commit_attempt, ctx.rpc.as_ref(), ctx.rpc_fallback.as_ref());
    let memo_ix = build_memo(memo_bytes, &[&ctx.keypair.pubkey()]);

    let blockhash = rpc
        .get_latest_blockhash()
        .await
        .map_err(|e| CommitFailure {
            kind: classify_client_error(&e),
            message: rpc_failure_message("get_latest_blockhash", e),
        })?;

    let tx = Transaction::new_signed_with_payer(
        &[memo_ix],
        Some(&ctx.keypair.pubkey()),
        &[ctx.keypair.as_ref()],
        blockhash,
    );

    let sig = rpc
        .send_and_confirm_transaction_with_spinner_and_commitment(
            &tx,
            CommitmentConfig::confirmed(),
        )
        .await
        .map_err(|e| CommitFailure {
            kind: classify_client_error(&e),
            message: rpc_failure_message("send_and_confirm", e),
        })?;
    Ok(sig.to_string())
}

fn rpc_failure_message(operation: &str, error: impl std::fmt::Display) -> String {
    format!(
        "{operation}: {}",
        pegana_common_verify::redact_urls_in_error(error)
    )
}

/// Map an RPC client error to our retry-policy buckets.
fn classify_client_error(err: &solana_rpc_client_api::client_error::Error) -> CommitErrorKind {
    if let Some(tx_err) = err.get_transaction_error() {
        return match tx_err {
            TransactionError::InsufficientFundsForFee => CommitErrorKind::InsufficientFunds,
            TransactionError::BlockhashNotFound => CommitErrorKind::Blockhash,
            _ => CommitErrorKind::Rpc,
        };
    }
    // String-match fallback — some upstream RPCs surface fee-insufficiency
    // as a preflight simulation error whose `to_string()` contains the
    // canonical token. Cheap belt-and-braces.
    let msg = err.to_string();
    if msg.contains("InsufficientFundsForFee") || msg.contains("insufficient funds for fee") {
        return CommitErrorKind::InsufficientFunds;
    }
    if msg.contains("BlockhashNotFound") || msg.contains("blockhash not found") {
        return CommitErrorKind::Blockhash;
    }
    CommitErrorKind::Rpc
}

/// Success path: write `commit_status='committed'` + the signature.
///
/// `WHERE commit_status='pending'` is defensive — the trigger from migration
/// 0033 already prevents writes over terminal states, but the explicit clause
/// avoids spurious trigger-rejection log lines in the steady state.
async fn persist_committed(pg: &PgPool, alert_id: Uuid, sig: &str) -> Result<()> {
    sqlx::query(
        "UPDATE alert_evidence
            SET commit_status = 'committed', onchain_tx_sig = $1
          WHERE alert_id = $2 AND commit_status = 'pending'",
    )
    .bind(sig)
    .bind(alert_id)
    .execute(pg)
    .await
    .context("update alert_evidence (committed)")?;
    Ok(())
}

/// Terminal-failure path: set commit_status to one of the explicit terminal
/// labels. Used by the synchronous wallet-drained path and by the background
/// retry worker (`run_commit_failures_retry`) for the 24h `retry_exhausted` /
/// `wallet_drained` cutoff.
async fn persist_terminal_status(pg: &PgPool, alert_id: Uuid, status: &str) -> Result<()> {
    sqlx::query(
        "UPDATE alert_evidence
            SET commit_status = $1
          WHERE alert_id = $2 AND commit_status = 'pending'",
    )
    .bind(status)
    .bind(alert_id)
    .execute(pg)
    .await
    .with_context(|| format!("update alert_evidence ({status})"))?;
    Ok(())
}

/// Record a failure row so the (deferred) background retry worker can pick
/// it up. ON CONFLICT keeps the first_failed_at + attempts logic on the
/// worker's side simple — repeated INSERTs from the engine just bump the
/// counters in a follow-up wave.
async fn record_commit_failure(
    pg: &PgPool,
    alert_id: Uuid,
    kind: CommitErrorKind,
    message: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO alert_evidence_commit_failures
             (alert_id, first_failed_at, last_attempted_at, attempts, last_error, error_kind)
         VALUES ($1, NOW(), NOW(), 1, $2, $3)
         ON CONFLICT (alert_id) DO UPDATE
             SET last_attempted_at = NOW(),
                 attempts = alert_evidence_commit_failures.attempts + 1,
                 last_error = EXCLUDED.last_error,
                 error_kind = EXCLUDED.error_kind",
    )
    .bind(alert_id)
    .bind(pegana_common_verify::redact_urls_in_error(message))
    .bind(kind.as_str())
    .execute(pg)
    .await
    .context("insert alert_evidence_commit_failures")?;
    Ok(())
}

/// Wallet-balance check — GAUGE-ONLY (operator decision 2026-05-31).
///
/// Sets the `pegana_commit_wallet_balance_sol` gauge every tick so Grafana panels
/// have a clean line; does NOT log or capture to Sentry on any threshold. The
/// tiered ERROR/WARN/INFO + 1h-throttled Sentry alarm (per ADR-0004) was removed
/// because a persistently-low wallet spammed the engine's stdout every 5 min and
/// the engine installs no sentry-tracing layer (so the log never reached Sentry
/// anyway). Alert on the gauge in Grafana if/when a proactive warning is wanted.
pub async fn check_wallet_balance(rpc: &RpcClient, keypair: &Keypair) -> Result<u64> {
    let lamports = rpc.get_balance(&keypair.pubkey()).await.map_err(|e| {
        anyhow::anyhow!(
            "get_balance: {}",
            pegana_common_verify::redact_urls_in_error(e)
        )
    })?;
    let sol = lamports as f64 / 1_000_000_000.0;
    metrics::gauge!("pegana_commit_wallet_balance_sol").set(sol);
    Ok(lamports)
}

/// Long-lived task: re-checks the wallet every `interval`. Spawned from
/// `main()` if `PEGANA_COMMIT_KEYPAIR` is set, per ADR-0004 (drain alarm
/// must continue past startup).
pub async fn run_wallet_balance_monitor(ctx: Arc<CommitContext>, interval: Duration) {
    let mut ticker = tokio::time::interval(interval);
    // Eat the immediate first tick — startup already called check_wallet_balance.
    ticker.tick().await;
    loop {
        ticker.tick().await;
        if let Err(e) = check_wallet_balance(&ctx.rpc, &ctx.keypair).await {
            warn!(
                ?e,
                "wallet balance monitor: check failed (will retry next tick)"
            );
        }
    }
}

// ===========================================================================
// ADR-0004 dead-letter retry worker for alert_evidence_commit_failures.
// ===========================================================================

/// Cadence of the dead-letter retry loop (ADR-0004: "retries every 1h").
const RETRY_INTERVAL: Duration = Duration::from_secs(60 * 60);

/// After this long since the first failure, the worker gives up on a row:
/// abandons the failure row and flips the parent `alert_evidence.commit_status`
/// to a terminal label (`retry_exhausted`, or `wallet_drained` if the last
/// error was funding-related). ADR-0004 default — adjustable per ops.
const ABANDON_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

/// One retryable failure row joined to its parent evidence row's commit data:
/// `(alert_id, methodology_version, receipt_sha256, error_kind, aged_out)`.
/// `aged_out` is `true` once `NOW() - first_failed_at > 24h` — drives the
/// abandon path.
type FailureRow = (Uuid, String, String, String, bool);

/// Counters for one retry pass — handy for tests + the periodic log line.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct RetryStats {
    pub scanned: usize,
    pub committed: usize,
    pub failed_again: usize,
    pub abandoned: usize,
}

/// Long-lived task: re-attempts on-chain commits that previously hard-failed.
///
/// Spawned from `main()` only when `CommitContext` exists (keypair present),
/// alongside `run_wallet_balance_monitor`. Re-uses the same burst semaphore and
/// `attempt_commit`/`do_commit_with_retry` machinery as the live path so a
/// retry storm cannot DoS the RPC quota.
pub async fn run_commit_failures_retry(ctx: Arc<CommitContext>) {
    let mut ticker = tokio::time::interval(RETRY_INTERVAL);
    // Eat the immediate first tick — give the live path a head start at boot.
    ticker.tick().await;
    loop {
        ticker.tick().await;
        match retry_once(&ctx).await {
            Ok(stats) => {
                if stats.committed > 0 || stats.abandoned > 0 {
                    info!(
                        scanned = stats.scanned,
                        committed = stats.committed,
                        failed_again = stats.failed_again,
                        abandoned = stats.abandoned,
                        "commit-failures retry pass"
                    );
                }
            }
            Err(e) => {
                warn!(
                    ?e,
                    "commit-failures retry pass failed (will retry next tick)"
                );
                metrics::counter!("pegana_commit_retry_pass_failed_total").increment(1);
            }
        }
    }
}

/// Single retry pass — extracted from the loop so tests can run exactly one
/// tick. Scans `alert_evidence_commit_failures` for rows that are still
/// eligible (`abandoned_at IS NULL AND last_attempted_at < NOW() - 1h`) AND
/// whose parent `alert_evidence.commit_status` is still `pending`, then for
/// each row either:
///   * aged past 24h → abandon + flip parent to a terminal status; or
///   * re-attempts the commit via `do_commit_with_retry` (respecting the burst
///     semaphore) and, on success, flips the parent to `committed`.
pub async fn retry_once(ctx: &Arc<CommitContext>) -> Result<RetryStats> {
    // The JOIN to alert_evidence enforces "only retry if commit_status is still
    // pending" — a row that already went terminal (committed/wallet_drained via
    // the live path) is skipped here.
    let rows: Vec<FailureRow> = sqlx::query_as(
        "SELECT f.alert_id, \
                e.methodology_version, \
                e.receipt_sha256, \
                f.error_kind, \
                (NOW() - f.first_failed_at) > $1 AS aged_out \
           FROM alert_evidence_commit_failures f \
           JOIN alert_evidence e ON e.alert_id = f.alert_id \
          WHERE f.abandoned_at IS NULL \
            AND f.last_attempted_at < NOW() - INTERVAL '1 hour' \
            AND e.commit_status = 'pending'",
    )
    .bind(pg_interval(ABANDON_AFTER))
    .fetch_all(&ctx.pg)
    .await
    .context("scan alert_evidence_commit_failures")?;

    let mut stats = RetryStats {
        scanned: rows.len(),
        ..Default::default()
    };

    for (alert_id, methodology_version, receipt_sha256, error_kind, aged_out) in rows {
        if aged_out {
            abandon_failure(ctx, alert_id, &error_kind).await?;
            stats.abandoned += 1;
            continue;
        }

        // Re-acquire a burst permit so retries share the live path's RPC budget.
        let permit = match ctx.semaphore.clone().acquire_owned().await {
            Ok(p) => p,
            Err(e) => {
                error!(?e, %alert_id, "retry: commit semaphore closed");
                break;
            }
        };
        let result = tokio::time::timeout(
            COMMIT_TIMEOUT,
            do_commit_with_retry(ctx.clone(), alert_id, &methodology_version, &receipt_sha256),
        )
        .await;
        drop(permit);
        metrics::gauge!("pegana_commit_queue_depth").set(ctx.semaphore.available_permits() as f64);

        match result {
            Ok(Ok(sig)) => {
                if let Err(e) = persist_committed(&ctx.pg, alert_id, &sig).await {
                    error!(?e, %alert_id, "retry: failed to persist committed sig");
                    metrics::counter!("pegana_onchain_persist_failed_total").increment(1);
                } else {
                    // Resolve the failure row so it stops being scanned.
                    if let Err(e) = resolve_failure(&ctx.pg, alert_id).await {
                        warn!(?e, %alert_id, "retry: failed to resolve failure row");
                    }
                    info!(%alert_id, signature = %sig, "retry: receipt committed on-chain");
                    stats.committed += 1;
                    metrics::counter!("pegana_commit_retry_total", "outcome" => "committed")
                        .increment(1);
                }
            }
            Ok(Err(failure)) => {
                // Still failing — bump the failure row's bookkeeping. The 24h
                // cutoff is evaluated on the next pass via `aged_out`.
                if let Err(e) =
                    record_commit_failure(&ctx.pg, alert_id, failure.kind, &failure.message).await
                {
                    error!(?e, %alert_id, "retry: failed to update failure row");
                }
                stats.failed_again += 1;
                metrics::counter!("pegana_commit_retry_total", "outcome" => "failed_again")
                    .increment(1);
            }
            Err(_) => {
                if let Err(e) = record_commit_failure(
                    &ctx.pg,
                    alert_id,
                    CommitErrorKind::Rpc,
                    "retry attempt timed out",
                )
                .await
                {
                    error!(?e, %alert_id, "retry: failed to update failure row (timeout)");
                }
                stats.failed_again += 1;
                metrics::counter!("pegana_commit_retry_total", "outcome" => "timeout").increment(1);
            }
        }
    }

    Ok(stats)
}

/// 24h cutoff: abandon the failure row and flip the parent `alert_evidence`
/// to a terminal status. `insufficient_funds` → `wallet_drained`; everything
/// else → `retry_exhausted` (ADR-0004). The `WHERE commit_status='pending'` on
/// `persist_terminal_status` keeps the trigger state machine happy.
async fn abandon_failure(ctx: &Arc<CommitContext>, alert_id: Uuid, error_kind: &str) -> Result<()> {
    let terminal = if error_kind == "insufficient_funds" {
        "wallet_drained"
    } else {
        "retry_exhausted"
    };

    if let Err(e) = persist_terminal_status(&ctx.pg, alert_id, terminal).await {
        error!(?e, %alert_id, status = terminal, "retry: failed to flip terminal status");
    }

    sqlx::query(
        "UPDATE alert_evidence_commit_failures \
            SET abandoned_at = NOW(), last_attempted_at = NOW() \
          WHERE alert_id = $1 AND abandoned_at IS NULL",
    )
    .bind(alert_id)
    .execute(&ctx.pg)
    .await
    .context("abandon alert_evidence_commit_failures row")?;

    error!(
        %alert_id,
        terminal_status = terminal,
        "on-chain commit abandoned after 24h — receipt remains verifiable offline"
    );
    sentry::capture_message(
        &format!("pegana commit retry abandoned ({terminal}): alert {alert_id}"),
        sentry::Level::Error,
    );
    metrics::counter!("pegana_commit_retry_total", "outcome" => "abandoned").increment(1);
    Ok(())
}

/// Mark a failure row resolved once its commit finally landed. Re-uses
/// `abandoned_at` as the "no longer scanned" sentinel (the partial index
/// `idx_commit_failures_pending` excludes `abandoned_at IS NOT NULL`), so the
/// row stays for forensic visibility without being retried again.
/// ⚠️ Writes the SAME `abandoned_at` column as `abandon_failure`, because the
/// partial index `idx_commit_failures_pending` uses it as the generic "stop
/// scanning this row" sentinel. So a resolved row and a given-up row are
/// indistinguishable in the table, and the column's name says only one of them.
///
/// That is not free: reading this table on 2026-08-13, a row with
/// `abandoned_at` set and `attempts = 1` was reported as "a receipt that never
/// made it on-chain, abandoned after one attempt". Its parent
/// `alert_evidence.commit_status` was `committed` with a signature — the retry
/// had SUCCEEDED. An operator asking "how many receipts did we give up on?"
/// gets the wrong answer from this schema, and did.
///
/// Distinguishing them properly needs a `resolved_at` column and a migration.
/// Until then: join to `alert_evidence.commit_status` before concluding
/// anything about a row here. `commit_status = 'retry_exhausted'` (or
/// `wallet_drained`) is the real signal for a receipt that was given up on.
async fn resolve_failure(pg: &PgPool, alert_id: Uuid) -> Result<()> {
    sqlx::query(
        "UPDATE alert_evidence_commit_failures \
            SET abandoned_at = NOW(), last_attempted_at = NOW() \
          WHERE alert_id = $1 AND abandoned_at IS NULL",
    )
    .bind(alert_id)
    .execute(pg)
    .await
    .context("resolve alert_evidence_commit_failures row")?;
    Ok(())
}

/// Render a `Duration` as a Postgres `INTERVAL` value (whole seconds).
fn pg_interval(d: Duration) -> sqlx::postgres::types::PgInterval {
    sqlx::postgres::types::PgInterval {
        months: 0,
        days: 0,
        microseconds: (d.as_secs() as i64) * 1_000_000,
    }
}

// ===========================================================================
// Test-support surface (used by tests/commit_retry_worker.rs).
//
// Integration tests live in a sibling crate and cannot reach private items.
// These thin `#[doc(hidden)]` shims expose exactly the abandon-path entry and
// the success-path DB transition so the worker logic is exercised end-to-end
// WITHOUT a live Solana RPC (the abandon/success branches are pure Postgres).
// ===========================================================================

impl CommitContext {
    /// Build a context with a dummy RPC + ephemeral keypair for tests that only
    /// drive the Postgres-only branches (`retry_once` abandon path,
    /// `commit_success_for_test`). The RPC is never contacted on those paths.
    #[doc(hidden)]
    pub fn new_for_test(pg: PgPool) -> Arc<Self> {
        let rpc = Arc::new(RpcClient::new("http://127.0.0.1:1".to_string()));
        Arc::new(Self {
            rpc: rpc.clone(),
            rpc_fallback: rpc,
            keypair: Arc::new(Keypair::new()),
            pg,
            semaphore: Arc::new(Semaphore::new(5)),
        })
    }
}

/// Apply exactly the success-path transition the worker runs after a commit
/// lands: flip the parent to `committed` + resolve the failure row. Lets tests
/// assert the success outcome without a live RPC round-trip.
#[doc(hidden)]
pub async fn commit_success_for_test(pg: &PgPool, alert_id: Uuid, sig: &str) -> Result<()> {
    persist_committed(pg, alert_id, sig).await?;
    resolve_failure(pg, alert_id).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{classify_client_error, rpc_for_attempt, CommitErrorKind};
    use solana_rpc_client_api::client_error::{Error as ClientError, ErrorKind as ClientErrorKind};
    use solana_transaction_error::TransactionError;

    // ── run_commit_loop: the retry-loop control flow, driven with scripted
    //    attempt outcomes + a sleep spy (no RpcClient, no real sleeps) ──
    use super::{
        run_commit_loop, CommitFailure, BLOCKHASH_MAX_RETRIES, RPC_BACKOFF, RPC_MAX_RETRIES,
    };
    use std::cell::{Cell, RefCell};
    use std::time::Duration;

    #[test]
    fn persisted_rpc_failure_message_redacts_keyed_url() {
        let message = super::rpc_failure_message(
            "send_and_confirm",
            "transport failure for url (https://rpc.example/FIXTURE_TOKEN?api-key=FIXTURE_TOKEN)",
        );
        assert!(!message.contains("FIXTURE_TOKEN"));
        assert!(message.contains("send_and_confirm"));
    }

    fn fail(kind: CommitErrorKind) -> CommitFailure {
        CommitFailure {
            kind,
            message: "test".to_string(),
        }
    }

    /// Run the loop against a scripted outcome sequence; return
    /// (result, attempts_made, backoff_sleeps_observed).
    async fn drive(
        script: Vec<Result<String, CommitFailure>>,
    ) -> (Result<String, CommitFailure>, usize, Vec<Duration>) {
        let i = Cell::new(0usize);
        let sleeps = RefCell::new(Vec::<Duration>::new());
        let r = run_commit_loop(
            uuid::Uuid::nil(),
            |_ca| {
                let o = script[i.get()].clone();
                i.set(i.get() + 1);
                async move { o }
            },
            |d| {
                sleeps.borrow_mut().push(d);
                async {}
            },
        )
        .await;
        (r, i.get(), sleeps.into_inner())
    }

    #[tokio::test]
    async fn commit_loop_succeeds_first_try() {
        let (r, attempts, sleeps) = drive(vec![Ok("SIG".into())]).await;
        assert_eq!(r.unwrap(), "SIG");
        assert_eq!(attempts, 1);
        assert!(sleeps.is_empty());
    }

    #[tokio::test]
    async fn commit_loop_insufficient_funds_is_terminal_no_retry() {
        let (r, attempts, sleeps) =
            drive(vec![Err(fail(CommitErrorKind::InsufficientFunds))]).await;
        assert!(matches!(
            r.unwrap_err().kind,
            CommitErrorKind::InsufficientFunds
        ));
        assert_eq!(attempts, 1, "a drained wallet must NEVER be retried");
        assert!(sleeps.is_empty());
    }

    #[tokio::test]
    async fn commit_loop_blockhash_refetches_immediately_then_succeeds() {
        let (r, attempts, sleeps) = drive(vec![
            Err(fail(CommitErrorKind::Blockhash)),
            Err(fail(CommitErrorKind::Blockhash)),
            Ok("SIG".into()),
        ])
        .await;
        assert_eq!(r.unwrap(), "SIG");
        assert_eq!(attempts, 3);
        assert!(
            sleeps.is_empty(),
            "blockhash retries are immediate — no backoff"
        );
    }

    #[tokio::test]
    async fn commit_loop_blockhash_exhausts_after_max() {
        let (r, attempts, sleeps) = drive(vec![Err(fail(CommitErrorKind::Blockhash)); 5]).await;
        assert!(matches!(r.unwrap_err().kind, CommitErrorKind::Blockhash));
        // BLOCKHASH_MAX_RETRIES + 1 = 3 attempts; and the blockhash path NEVER
        // sleeps — not even on the exhaustion branch.
        assert_eq!(attempts, (BLOCKHASH_MAX_RETRIES + 1) as usize);
        assert!(sleeps.is_empty());
    }

    #[tokio::test]
    async fn commit_loop_rpc_backs_off_exponentially_then_succeeds() {
        let (r, attempts, sleeps) = drive(vec![
            Err(fail(CommitErrorKind::Rpc)),
            Err(fail(CommitErrorKind::Rpc)),
            Ok("SIG".into()),
        ])
        .await;
        assert_eq!(r.unwrap(), "SIG");
        assert_eq!(attempts, 3);
        // Locks the backoff-array indexing (the off-by-one-prone part): [1s, 5s].
        assert_eq!(sleeps, RPC_BACKOFF[..2].to_vec());
    }

    #[tokio::test]
    async fn commit_loop_rpc_exhausts_over_the_full_backoff_ladder() {
        let (r, attempts, sleeps) = drive(vec![Err(fail(CommitErrorKind::Rpc)); 6]).await;
        assert!(matches!(r.unwrap_err().kind, CommitErrorKind::Rpc));
        assert_eq!(attempts, RPC_MAX_RETRIES as usize + 1); // 4 = 3 retries + the exhausting attempt
        assert_eq!(sleeps, RPC_BACKOFF.to_vec()); // [1s, 5s, 15s], in order
    }

    // classify_client_error is the retry SM's most consequential decision: it
    // decides which failures are TERMINAL (InsufficientFunds → wallet_drained,
    // never retried into a drained wallet) vs retryable (Blockhash → refetch,
    // Rpc → backoff). It spends real SOL, so it must be exact. (audit 2026-07-18)
    #[test]
    fn classify_maps_typed_transaction_errors_to_retry_buckets() {
        let e: ClientError =
            ClientErrorKind::TransactionError(TransactionError::InsufficientFundsForFee).into();
        assert!(matches!(
            classify_client_error(&e),
            CommitErrorKind::InsufficientFunds
        ));

        let e: ClientError =
            ClientErrorKind::TransactionError(TransactionError::BlockhashNotFound).into();
        assert!(matches!(
            classify_client_error(&e),
            CommitErrorKind::Blockhash
        ));

        // Any other typed tx error → generic RPC backoff-retry.
        let e: ClientError =
            ClientErrorKind::TransactionError(TransactionError::AccountInUse).into();
        assert!(matches!(classify_client_error(&e), CommitErrorKind::Rpc));
    }

    #[test]
    fn classify_string_fallback_catches_preflight_fee_and_blockhash() {
        // Some RPCs surface fee-insufficiency as a PREFLIGHT sim error whose
        // to_string() carries the token but get_transaction_error() is None —
        // the loop must STILL treat it as terminal, not retry into a drained
        // wallet. This is the belt-and-braces path classify has for exactly that.
        let e: ClientError = ClientErrorKind::Custom(
            "Transaction simulation failed: insufficient funds for fee".to_string(),
        )
        .into();
        assert!(matches!(
            classify_client_error(&e),
            CommitErrorKind::InsufficientFunds
        ));

        let e: ClientError = ClientErrorKind::Custom("blockhash not found".to_string()).into();
        assert!(matches!(
            classify_client_error(&e),
            CommitErrorKind::Blockhash
        ));

        // Unrelated transport error → Rpc (retryable), NOT terminal.
        let e: ClientError = ClientErrorKind::Custom("connection reset by peer".to_string()).into();
        assert!(matches!(classify_client_error(&e), CommitErrorKind::Rpc));
    }

    // The anchor-gate is now defined ONCE (is_anchorable) and used by both the
    // commit trigger and the initial commit_status stamp — this locks the policy
    // (ADR-0004 severe-only) so the two call sites can't silently diverge.
    #[test]
    fn is_anchorable_only_severe_states() {
        use pegana_common::PegState;
        assert!(super::is_anchorable(PegState::Depeg));
        assert!(super::is_anchorable(PegState::Critical));
        assert!(super::is_anchorable(PegState::BlackSwan));
        assert!(!super::is_anchorable(PegState::Pegged));
        assert!(!super::is_anchorable(PegState::Drift));
        assert!(!super::is_anchorable(PegState::Unknown));
    }

    #[test]
    fn rpc_for_attempt_starts_primary_then_alternates_on_retry() {
        let primary = "primary";
        let fallback = "fallback";

        assert!(std::ptr::eq(
            rpc_for_attempt(0, &primary, &fallback),
            &primary
        ));
        assert!(std::ptr::eq(
            rpc_for_attempt(1, &primary, &fallback),
            &fallback
        ));
        assert!(std::ptr::eq(
            rpc_for_attempt(2, &primary, &fallback),
            &primary
        ));
        assert!(std::ptr::eq(
            rpc_for_attempt(3, &primary, &fallback),
            &fallback
        ));
    }
}
