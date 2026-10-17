//! Ed25519-signed webhook channel (Plan 2 Track G).
//!
//! Pure-Rust signing of `<timestamp>.<body>` payloads + reqwest-based
//! dispatch with exponential-backoff retry. Dead-letter persistence
//! lives in `webhook_queries`; this module owns the signing format and
//! the per-event HTTP loop.

use pegana_common::webhook_response::read_truncated_body;
use pegana_common::webhook_sign::SigningKeys;
// Re-export the shared signing primitive surface so existing tests
// (`tests/webhook_signing.rs`, `tests/webhook_receivers.rs`) and
// downstream call sites can keep importing from this module. The
// `allow(unused_imports)` is for the bin target — the test/lib
// targets DO consume these symbols.
#[allow(unused_imports)]
pub use pegana_common::webhook_sign::{
    sign_payload, verify_payload, verify_payload_any, SigningKey, VerifyingKey,
};
use pegana_common::webhook_url::{
    pinned_webhook_client, validate_url_runtime, validate_url_static,
};
use reqwest::Client;
use rust_decimal::Decimal;
use serde_json::Value;
use sqlx::PgPool;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::time::sleep;
use uuid::Uuid;

/// Dispatcher-loop configuration. Built once at process startup and
/// shared (cloned `Arc`) across the fan-out spawn for each AlertEvent.
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
/// we spawn a tokio task per delivery, so leaving permits held for the
/// full Svix envelope (~28h) would risk exhausting the 50-permit pool
/// during a sustained outage of a single subscriber. The 2h cap keeps
/// the recovery window meaningful without that exposure.
///
/// To extend to the full Svix envelope, move retries to a persistent
/// queue (Postgres row per pending delivery + cron) and drop the
/// in-memory loop. Tracked as v2.1 work.
// Consumed by the bin target (`main.rs` seeds `DispatchConfig.retry_backoffs_secs`
// with this); the lib target itself reads the config field, so the `allow`
// suppresses the spurious lib-only dead-code warning (same as `decimal_to_f64`).
#[allow(dead_code)]
pub(crate) const RETRY_BACKOFFS_SEC: &[u64] = &[5, 30, 300, 1800, 7200];

/// POST a signed payload to `url`. Retries on non-2xx / network error
/// with exponential backoff per `RETRY_BACKOFFS_SEC`. Returns the HTTP
/// status on success, the last error string on giveup.
///
/// Headers sent with every attempt:
///   - `x-pegana-signature: ed25519:<base64 sig>` — Ed25519 over
///     `<ts>.<body>`
///   - `x-pegana-timestamp: <unix seconds>` — anti-replay anchor
///   - `x-pegana-event-id: <uuid>` — stable across retries; matches
///     `alert_id` in body. Lets receivers dedupe at the header level
///     without parsing JSON. (GitHub `X-GitHub-Delivery` pattern.)
///   - `x-pegana-delivery-id: <uuid>` — fresh per attempt. Lets
///     receivers correlate logs and dedupe accidental double-fires
///     within the same retry chain.
///   - `x-pegana-attempt: <n>/<max>` — current attempt vs envelope.
///     Receivers can use this to short-circuit acks on the final
///     attempt or page on `n == max - 1`.
pub async fn dispatch_one(
    cfg: &DispatchConfig,
    pg: Option<&PgPool>,
    subscription_id: Uuid,
    url: &str,
    alert_id: Uuid,
    payload: &Value,
    sign: bool,
) -> Result<u16, String> {
    // SSRF defense — static parse once (URL structure is invariant across
    // attempts), then re-resolve DNS before EACH send inside the loop below. A
    // subscription safe at registration can rebind to a private IP; refuse
    // rather than POST signed payloads to internal infrastructure. Bypass with
    // WEBHOOK_SSRF_ALLOW_LOOPBACK=1 for local integration tests.
    let parsed = validate_url_static(url).map_err(|e| format!("ssrf static: {e}"))?;

    let body = serde_json::to_string(payload).map_err(|e| e.to_string())?;

    // A SIGNED (machine) webhook with no configured signing key cannot be
    // delivered — an unsigned body fails the receiver's Ed25519 verify. Skip it
    // once (surfacing the misconfig) rather than retry an undeliverable payload.
    // The dispatcher itself never crash-loops for this: Telegram + unsigned chat
    // webhooks keep working (see SigningKeys::from_env_optional / ADR-compose contract).
    if sign && cfg.signing_keys.is_none() {
        return Err(
            "webhook requires an Ed25519 signature but PEGANA_WEBHOOK_SIGNING_KEY is unset"
                .to_string(),
        );
    }

    let mut backoffs = cfg
        .retry_backoffs_secs
        .iter()
        .copied()
        .map(Duration::from_secs);
    let mut last_err = String::new();
    // Cumulative retry envelope (~2h35m). Every sleep — curve OR a receiver's
    // 429 Retry-After — draws from this shared budget, so a hostile 429 can't
    // pin a webhook_sem permit longer than our OWN total envelope (the bug was
    // clamping each Retry-After to MAX_BACKOFF_SECS independently → ~4× the cap).
    let total_budget_secs: u64 = cfg.retry_backoffs_secs.iter().sum();
    let mut budget_used_secs: u64 = 0;

    for attempt in 1..=cfg.max_attempts {
        // SSRF runtime DNS re-check BEFORE EACH send. The retry curve spans
        // ~2h35m; a host that resolved safe at attempt 1 can rebind to a
        // private/metadata IP before a later retry. Re-resolve and refuse
        // (return Err) rather than deliver a signed payload to an internal host.
        let safe_addrs = match validate_url_runtime(&parsed).await {
            Ok(addrs) => addrs,
            Err(e) => return Err(format!("ssrf runtime (attempt {attempt}): {e}")),
        };
        // Pin the connect to the just-vetted addrs so a rebinding DNS cannot swing
        // this send to an internal IP between validation and connect. Empty vec =
        // the dev loopback bypass → fall back to the shared (unpinned) client.
        let pinned;
        let client: &reqwest::Client = if safe_addrs.is_empty() {
            &cfg.http
        } else {
            pinned = pinned_webhook_client(parsed.host_str().unwrap_or_default(), &safe_addrs)
                .map_err(|e| format!("pinned client (attempt {attempt}): {e}"))?;
            &pinned
        };
        // Receiver-supplied Retry-After (429) overrides the curve for the
        // NEXT sleep when present. Reset each attempt.
        let mut retry_after: Option<u64> = None;
        // Fresh delivery-id per attempt; alert_id stable across retries.
        let delivery_id = Uuid::new_v4();
        // FRESH timestamp + signature PER ATTEMPT. Receivers enforce a 300s replay
        // window (|now − x-pegana-timestamp| ≤ 300); the retry curve spans ~2h35m,
        // so a `ts` frozen at attempt 1 made every retry past ~5min DOA against a
        // spec-compliant receiver (landing in the dead-letter path on any receiver
        // hiccup). The BODY is fixed — the signed canonical is stable — only ts/sig
        // move here. Signing is for generic machine receivers only; chat sinks
        // (Discord/Slack) can't verify Ed25519.
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs()
            .to_string();
        // `(true, None)` is unreachable — the pre-loop guard already returned Err
        // for a signed webhook with no key; a chat webhook (sign=false) stays None.
        let sig = match (sign, cfg.signing_keys.as_ref()) {
            (true, Some(keys)) => Some(sign_payload(&keys.primary, &ts, &body)),
            _ => None,
        };
        let started = std::time::Instant::now();
        let mut req = client
            .post(url)
            .header("x-pegana-event-id", alert_id.to_string())
            .header("x-pegana-delivery-id", delivery_id.to_string())
            .header(
                "x-pegana-attempt",
                format!("{}/{}", attempt, cfg.max_attempts),
            )
            .header("content-type", "application/json")
            .body(body.clone())
            .timeout(Duration::from_secs(5));
        if let Some(ref s) = sig {
            req = req
                .header("x-pegana-signature", format!("ed25519:{s}"))
                .header("x-pegana-timestamp", &ts);
        }
        let res = req.send().await;
        let elapsed_ms = started.elapsed().as_millis() as i32;
        match res {
            Ok(r) if r.status().is_success() => {
                let status = r.status().as_u16();
                record_delivery(
                    pg,
                    subscription_id,
                    alert_id,
                    attempt as i16,
                    Some(status as i16),
                    elapsed_ms,
                    None,
                    false,
                )
                .await;
                return Ok(status);
            }
            Ok(r) => {
                let status_display = r.status();
                let status = status_display.as_u16();
                // Honor a receiver's rate-limit hint (Discord returns 429 +
                // Retry-After ~30/min/channel). Read the header BEFORE the
                // body consumes `r`.
                if status == 429 {
                    retry_after = parse_retry_after(r.headers());
                }
                // Bounded read — a malicious receiver returning a 100 MB
                // error page must not OOM the dispatcher or bloat
                // `webhook_deliveries.error`. Cap enforced in common.
                last_err = format!("http {}: {}", status_display, read_truncated_body(r).await);
                record_delivery(
                    pg,
                    subscription_id,
                    alert_id,
                    attempt as i16,
                    Some(status as i16),
                    elapsed_ms,
                    Some(&last_err),
                    false,
                )
                .await;
            }
            Err(e) => {
                last_err = e.to_string();
                record_delivery(
                    pg,
                    subscription_id,
                    alert_id,
                    attempt as i16,
                    None,
                    elapsed_ms,
                    Some(&last_err),
                    false,
                )
                .await;
            }
        }
        if attempt < cfg.max_attempts {
            let curve = backoffs.next();
            let raw_delay_secs = match retry_after {
                Some(s) => s,
                None => curve.map(|d| d.as_secs()).unwrap_or(MAX_BACKOFF_SECS),
            };
            // Clamp to the REMAINING cumulative envelope. Curve-only paths are
            // unaffected (the 5 backoffs sum to exactly total_budget_secs); a
            // 429 that eats budget early just compresses the remaining sleeps.
            let delay_secs = raw_delay_secs.min(total_budget_secs.saturating_sub(budget_used_secs));
            budget_used_secs += delay_secs;
            sleep(Duration::from_secs(delay_secs)).await;
        }
    }
    Err(last_err)
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
