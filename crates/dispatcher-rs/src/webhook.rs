//! Ed25519-signed webhook channel (Plan 2 Track G).
//!
//! Pure-Rust signing of v1 `<timestamp>.<body>` and v2
//! `<timestamp>.<event-id>.<body>` payloads + reqwest-based
//! dispatch with exponential-backoff retry. Dead-letter persistence
//! lives in `webhook_queries`; this module owns the signing format and
//! the per-event HTTP loop.

use crate::delivery::{global_pool, Admit, DeliveryError, DeliveryPool, ProbeGuard};
use pegana_common::webhook_response::read_truncated_body;
use pegana_common::webhook_sign::SigningKeys;
// Re-export the shared signing primitive surface so existing tests
// (`tests/webhook_signing.rs`, `tests/webhook_receivers.rs`) and
// downstream call sites can keep importing from this module. The
// `allow(unused_imports)` is for the bin target — the test/lib
// targets DO consume these symbols.
#[allow(unused_imports)]
pub use pegana_common::webhook_sign::{
    sign_payload, sign_payload_v2, verify_payload, verify_payload_any, verify_payload_v2_any,
    SigningKey, VerifyingKey,
};
use pegana_common::webhook_url::{
    pinned_webhook_client, validate_url_runtime, validate_url_static,
};
use reqwest::Client;
use rust_decimal::Decimal;
use serde_json::Value;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::time::sleep;
use uuid::Uuid;

/// Dispatcher-loop configuration. Built once at process startup and
/// shared (cloned `Arc`) across the fan-out spawn for each AlertEvent.
#[derive(Clone)]
pub struct DispatchConfig {
    /// Active keyset. Primary signs every outbound payload; secondary
    /// (when present during a rotation window) is exposed via
    /// `/v1/meta/webhook-keys` so receivers can pre-trust it.
    /// `None` when `PEGANA_WEBHOOK_SIGNING_KEY` is unset — the dispatcher still
    /// runs (unsigned chat webhooks); only SIGNED machine webhooks are skipped
    /// until a key is configured. See `SigningKeys::from_env_optional`.
    pub signing_keys: Option<SigningKeys>,
    pub http: Client,
    pub max_attempts: u8,
    /// Base URL for `/audit/{id}` links surfaced to subscribers.
    /// Loaded once at startup from `AUDIT_BASE_URL` env via
    /// `pegana_common::audit_base_url()` (defaults to `https://pegana.xyz`).
    pub audit_base_url: String,
    /// Between-attempt backoff curve, in seconds (production: `RETRY_BACKOFFS_SEC`).
    /// Injectable so integration tests can pass a near-zero curve and exercise the
    /// real retry path (per-attempt id/timestamp/signature rotation) in CI without
    /// the ~36s of real sleeps.
    pub retry_backoffs_secs: Vec<u64>,
}

/// `rust_decimal::Decimal` → `f64` via `TryInto`. Mirrors the helper
/// `indexer-rs/src/sources/piggybank_pb.rs:309` so we don't pull in
/// `rust_decimal::prelude::ToPrimitive` (extra trait import for one
/// site). Consumed only by the bin target (`main.rs::process`) —
/// the `allow` suppresses the spurious lib-target dead-code warning.
#[allow(dead_code)]
pub(crate) fn decimal_to_f64(d: Decimal) -> f64 {
    d.try_into().unwrap_or(0.0)
}

/// Retry curve between consecutive POST attempts, in seconds.
///
/// 5s · 30s · 5min · 30min · 2h = 5 backoffs → up to 6 total attempts
/// over ~2h35m worst case. Modeled on Svix's published curve (5s, 5m,
/// 30m, 2h, 5h, 10h, 10h) compressed for our in-memory dispatch model:
/// we spawn a tokio task per delivery. HTTP-attempt permits are taken per
/// attempt and released before every sleep (see `delivery.rs`), so a long
/// envelope no longer pins shared capacity; the 2h cap keeps the recovery
/// window meaningful.
///
/// To extend to the full Svix envelope, move retries to a persistent
/// queue (Postgres row per pending delivery + cron) and drop the
/// in-memory loop. Tracked as v2.1 work.
// Consumed by the bin target (`main.rs` seeds `DispatchConfig.retry_backoffs_secs`
// with this); the lib target itself reads the config field, so the `allow`
// suppresses the spurious lib-only dead-code warning (same as `decimal_to_f64`).
#[allow(dead_code)]
pub(crate) const RETRY_BACKOFFS_SEC: &[u64] = &[5, 30, 300, 1800, 7200];

/// Event id for a follow-up event about an alert: UUIDv5 with the alert id as
/// namespace and the event kind as name (e.g. `retraction:<version>`,
/// `evidence:1`). Deterministic, so retries and restarts reuse the same id,
/// while differing from the original alert's id so receivers that dedupe on
/// `x-pegana-event-id` do not drop it.
pub fn event_id_for(alert_id: Uuid, kind: &str) -> Uuid {
    Uuid::new_v5(&alert_id, kind.as_bytes())
}

/// POST a signed payload to `url`. Retries on non-2xx / network error
/// with exponential backoff per `RETRY_BACKOFFS_SEC`. Returns the HTTP
/// status on success, the last error string on giveup.
///
/// Headers sent with every attempt:
///   - `x-pegana-signature: ed25519:<base64 sig>` — Ed25519 over
///     `<ts>.<body>`
///   - `x-pegana-signature-v2: ed25519:<base64 sig>` — Ed25519 over
///     `pegana-webhook-v2.<ts>.<event-id>.<body>` using the same primary key and exact body bytes
///   - `x-pegana-timestamp: <unix seconds>` — anti-replay anchor
///   - `x-pegana-event-id: <uuid>` — stable across retries of ONE event and
///     unique per event: the original alert uses its `alert_id` (backward
///     compatible), retractions and evidence re-fires use [`event_id_for`].
///     Lets receivers dedupe at the header level without parsing JSON. (GitHub `X-GitHub-Delivery` pattern.)
///   - `x-pegana-delivery-id: <uuid>` — fresh per attempt. Lets
///     receivers correlate logs and dedupe accidental double-fires
///     within the same retry chain.
///   - `x-pegana-attempt: <n>/<max>` — current attempt vs envelope.
///     Receivers can use this to short-circuit acks on the final
///     attempt or page on `n == max - 1`.
#[allow(clippy::too_many_arguments)]
pub async fn dispatch_one(
    cfg: &DispatchConfig,
    pg: Option<&PgPool>,
    subscription_id: Uuid,
    url: &str,
    alert_id: Uuid,
    event_id: Uuid,
    payload: &Value,
    sign: bool,
) -> Result<u16, DeliveryError> {
    dispatch_with(
        global_pool(),
        cfg,
        pg,
        subscription_id,
        url,
        alert_id,
        event_id,
        payload,
        sign,
    )
    .await
}

/// [`dispatch_one`] against an explicit [`DeliveryPool`].
///
/// Fairness rules: the chain for one subscription runs alone (later deliveries
/// of the same subscription wait on that subscription's own lock, holding no
/// shared resource); a shared HTTP-attempt permit is held only around one DNS
/// check plus request, and released before any backoff sleep; the breaker is
/// fed by every failed attempt and stops a chain as soon as it opens.
#[allow(clippy::too_many_arguments)]
pub async fn dispatch_with(
    pool: &Arc<DeliveryPool>,
    cfg: &DispatchConfig,
    pg: Option<&PgPool>,
    subscription_id: Uuid,
    url: &str,
    alert_id: Uuid,
    event_id: Uuid,
    payload: &Value,
    sign: bool,
) -> Result<u16, DeliveryError> {
    dispatch_with_mode(
        pool,
        cfg,
        pg,
        subscription_id,
        url,
        alert_id,
        event_id,
        payload,
        sign,
        Mode::Live,
    )
    .await
}

/// How a delivery interacts with the circuit breaker.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// A live delivery: admitted through the breaker (closed / probe / open)
    /// and every failed attempt counts toward opening it.
    Live,
    /// A replay of a deferred delivery: never takes the half-open probe slot,
    /// refuses to send while the breaker is open, and a permanent receiver
    /// rejection (a 4xx that retrying cannot fix) says nothing about the
    /// subscriber's health, so it does not feed the breaker.
    Replay,
}

/// `dispatch_one` for replays: same pool, breaker-neutral for permanent
/// rejections.
#[allow(clippy::too_many_arguments)]
pub async fn dispatch_replay(
    cfg: &DispatchConfig,
    pg: Option<&PgPool>,
    subscription_id: Uuid,
    url: &str,
    alert_id: Uuid,
    event_id: Uuid,
    payload: &Value,
    sign: bool,
) -> Result<u16, DeliveryError> {
    dispatch_with_mode(
        global_pool(),
        cfg,
        pg,
        subscription_id,
        url,
        alert_id,
        event_id,
        payload,
        sign,
        Mode::Replay,
    )
    .await
}

/// [`dispatch_with`] with an explicit breaker [`Mode`].
#[allow(clippy::too_many_arguments)]
pub async fn dispatch_with_mode(
    pool: &Arc<DeliveryPool>,
    cfg: &DispatchConfig,
    pg: Option<&PgPool>,
    subscription_id: Uuid,
    url: &str,
    alert_id: Uuid,
    event_id: Uuid,
    payload: &Value,
    sign: bool,
    mode: Mode,
) -> Result<u16, DeliveryError> {
    // SSRF defense — static parse once (URL structure is invariant across
    // attempts), then re-resolve DNS before EACH send inside the loop below. A
    // subscription safe at registration can rebind to a private IP; refuse
    // rather than POST signed payloads to internal infrastructure.
    let parsed =
        validate_url_static(url).map_err(|e| DeliveryError::Ssrf(format!("ssrf static: {e}")))?;

    let body = serde_json::to_string(payload).map_err(|e| DeliveryError::Config(e.to_string()))?;

    // A SIGNED (machine) webhook with no configured signing key cannot be
    // delivered — an unsigned body fails the receiver's Ed25519 verify. Skip it
    // once (surfacing the misconfig) rather than retry an undeliverable payload.
    if sign && cfg.signing_keys.is_none() {
        return Err(DeliveryError::Config(
            "webhook requires an Ed25519 signature but PEGANA_WEBHOOK_SIGNING_KEY is unset"
                .to_string(),
        ));
    }

    // Bounded backlog per subscription: beyond it, defer (dead-letter with the
    // breaker marker, replayed on recovery) instead of piling up waiters.
    let Some(_pending) = pool.enter_sub(subscription_id) else {
        return Err(DeliveryError::Deferred {
            reason: "per-subscriber backlog full".to_string(),
        });
    };
    // Single-flight per subscription: one chain at a time.
    let flight = pool.sub_lock(subscription_id);
    let _flight = flight.lock().await;

    let admitted = match mode {
        Mode::Live => pool.breaker.admit(subscription_id, Instant::now()),
        Mode::Replay if pool.breaker.is_open(subscription_id, Instant::now()) => Admit::Open,
        Mode::Replay => Admit::Closed,
    };
    let mut probe = ProbeGuard::new(pool, subscription_id, admitted == Admit::Probe);
    let max_attempts = match admitted {
        Admit::Closed => cfg.max_attempts,
        Admit::Probe => 1,
        Admit::Open => {
            return Err(DeliveryError::BreakerOpen {
                attempts: 0,
                last_error: "subscriber deliveries are paused".to_string(),
            })
        }
    };

    let mut backoffs = cfg
        .retry_backoffs_secs
        .iter()
        .copied()
        .map(Duration::from_secs);
    let mut last_err = String::new();
    let mut last_status: Option<u16> = None;
    // Cumulative retry envelope (~2h35m). Every sleep — curve OR a receiver's
    // 429 Retry-After — draws from this shared budget.
    let total_budget_secs: u64 = cfg.retry_backoffs_secs.iter().sum();
    let mut budget_used_secs: u64 = 0;

    for attempt in 1..=max_attempts {
        if attempt > 1 && pool.breaker.is_open(subscription_id, Instant::now()) {
            return Err(DeliveryError::BreakerOpen {
                attempts: attempt - 1,
                last_error: last_err,
            });
        }
        // Receiver-supplied Retry-After (429) overrides the curve for the
        // NEXT sleep when present. Reset each attempt.
        let mut retry_after: Option<u64> = None;
        // Fresh delivery-id per attempt; the event id is stable across retries.
        let delivery_id = Uuid::new_v4();
        // FRESH timestamp + signature PER ATTEMPT (receivers enforce a 300s
        // replay window; the retry curve spans ~2h35m). The BODY is fixed.
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| DeliveryError::Config(e.to_string()))?
            .as_secs()
            .to_string();
        let event_id = event_id.to_string();
        let sigs = match (sign, cfg.signing_keys.as_ref()) {
            (true, Some(keys)) => Some((
                sign_payload(&keys.primary, &ts, &body),
                sign_payload_v2(&keys.primary, &ts, &event_id, &body),
            )),
            _ => None,
        };

        // ── one HTTP attempt, under a shared permit ──────────────────────
        let permit = pool.acquire_attempt().await;
        let started = std::time::Instant::now();
        // SSRF runtime DNS re-check BEFORE EACH send (the host may have rebound
        // to a private address since the last attempt).
        let safe_addrs = match validate_url_runtime(&parsed).await {
            Ok(addrs) => addrs,
            Err(e) => {
                drop(permit);
                pool.publish_permits();
                return Err(DeliveryError::Ssrf(format!(
                    "ssrf runtime (attempt {attempt}): {e}"
                )));
            }
        };
        // Pin the connect to the just-vetted addrs. Empty vec = the dev
        // loopback bypass → fall back to the shared (unpinned) client.
        let pinned;
        let client: &reqwest::Client = if safe_addrs.is_empty() {
            &cfg.http
        } else {
            match pinned_webhook_client(parsed.host_str().unwrap_or_default(), &safe_addrs) {
                Ok(c) => {
                    pinned = c;
                    &pinned
                }
                Err(e) => {
                    drop(permit);
                    pool.publish_permits();
                    return Err(DeliveryError::Config(format!(
                        "pinned client (attempt {attempt}): {e}"
                    )));
                }
            }
        };
        let mut req = client
            .post(url)
            .header("x-pegana-event-id", &event_id)
            .header("x-pegana-delivery-id", delivery_id.to_string())
            .header("x-pegana-attempt", format!("{}/{}", attempt, max_attempts))
            .header("content-type", "application/json")
            .body(body.clone())
            .timeout(Duration::from_secs(5));
        if let Some((ref v1, ref v2)) = sigs {
            req = req
                .header("x-pegana-signature", format!("ed25519:{v1}"))
                .header("x-pegana-signature-v2", format!("ed25519:{v2}"))
                .header("x-pegana-timestamp", &ts);
        }
        let res = req.send().await;
        let elapsed_ms = started.elapsed().as_millis() as i32;
        // (http status, failure text) — None text means success.
        let (status, failure): (Option<u16>, Option<String>) = match res {
            Ok(r) if r.status().is_success() => (Some(r.status().as_u16()), None),
            Ok(r) => {
                let status_display = r.status();
                let status = status_display.as_u16();
                // Honor a receiver's rate-limit hint (Discord returns 429 +
                // Retry-After). Read the header BEFORE the body consumes `r`.
                if status == 429 {
                    retry_after = parse_retry_after(r.headers());
                }
                // Bounded read — a malicious receiver must not OOM the
                // dispatcher or bloat `webhook_deliveries.error`.
                (
                    Some(status),
                    Some(format!(
                        "http {}: {}",
                        status_display,
                        read_truncated_body(r).await
                    )),
                )
            }
            // Strip the URL: Discord/Slack-style webhook URLs carry their
            // secret in the path and must not reach logs or the DB.
            Err(e) => (None, Some(e.without_url().to_string())),
        };
        drop(permit);
        pool.publish_permits();
        // ─────────────────────────────────────────────────────────────────

        record_delivery(
            pg,
            subscription_id,
            alert_id,
            attempt as i16,
            status.map(|s| s as i16),
            elapsed_ms,
            failure.as_deref(),
            false,
        )
        .await;
        match failure {
            None => {
                pool.breaker.record_success(subscription_id);
                probe.disarm();
                return Ok(status.unwrap_or(200));
            }
            Some(err) => {
                last_err = err;
                last_status = status;
                let permanent =
                    matches!(status, Some(c) if (400..500).contains(&c) && c != 408 && c != 429);
                if mode == Mode::Replay && permanent {
                    // Not a health signal: leave the breaker alone, end the chain.
                    return Err(DeliveryError::Delivery {
                        error: last_err,
                        attempts: attempt,
                        status,
                    });
                }
                let opened = pool.breaker.record_failure(subscription_id, Instant::now());
                probe.disarm();
                if opened {
                    tracing::warn!(sub_id = %subscription_id, "webhook circuit breaker opened");
                    metrics::counter!("pegana_dispatcher_breaker_open_total").increment(1);
                }
                // The breaker opened (mid-chain, on the last attempt, or a failed
                // half-open probe): stop retrying and report it as deferred so
                // the caller dead-letters it with the attempts actually made and
                // it is replayed once the subscriber recovers.
                if opened {
                    return Err(DeliveryError::BreakerOpen {
                        attempts: attempt,
                        last_error: last_err,
                    });
                }
            }
        }
        if attempt < max_attempts {
            let curve = backoffs.next();
            let raw_delay_secs = match retry_after {
                Some(s) => s,
                None => curve.map(|d| d.as_secs()).unwrap_or(MAX_BACKOFF_SECS),
            };
            // Clamp to the REMAINING cumulative envelope. No permit is held
            // while sleeping.
            let delay_secs = raw_delay_secs.min(total_budget_secs.saturating_sub(budget_used_secs));
            budget_used_secs += delay_secs;
            sleep(Duration::from_secs(delay_secs)).await;
        }
    }
    Err(DeliveryError::Delivery {
        error: last_err,
        attempts: max_attempts,
        status: last_status,
    })
}

/// Cap on a receiver-supplied `Retry-After` so a hostile/broken 429 can't
/// pin an in-memory permit longer than our own retry envelope.
const MAX_BACKOFF_SECS: u64 = 7200;

/// Parse a `Retry-After` header as whole seconds (integer or float form),
/// clamped to `MAX_BACKOFF_SECS`. Returns `None` if absent/unparseable.
fn parse_retry_after(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    let raw = headers.get(reqwest::header::RETRY_AFTER)?.to_str().ok()?;
    let secs = raw
        .trim()
        .parse::<u64>()
        .ok()
        .or_else(|| raw.trim().parse::<f64>().ok().map(|f| f.ceil() as u64))?;
    Some(secs.min(MAX_BACKOFF_SECS))
}

/// Best-effort insert into `webhook_deliveries`. Skipped when `pg` is
/// `None` (in-test loopback runs). Logged-and-swallowed on failure so
/// a transient pg error never aborts an in-flight retry chain.
/// Retention is the operator's problem — schedule a vacuum on
/// `attempted_at` from cron if volume warrants.
#[allow(clippy::too_many_arguments)]
async fn record_delivery(
    pg: Option<&PgPool>,
    subscription_id: Uuid,
    alert_id: Uuid,
    attempt: i16,
    http_status: Option<i16>,
    elapsed_ms: i32,
    error: Option<&str>,
    is_test: bool,
) {
    let Some(pg) = pg else { return };
    let res = sqlx::query(
        "INSERT INTO webhook_deliveries
           (subscription_id, alert_id, attempt, http_status,
            elapsed_ms, error, is_test)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(subscription_id)
    .bind(alert_id)
    .bind(attempt)
    .bind(http_status)
    .bind(elapsed_ms)
    .bind(error)
    .bind(is_test)
    .execute(pg)
    .await;
    if let Err(e) = res {
        tracing::warn!(error=?e, "webhook_deliveries insert failed; swallowing");
    }
}
