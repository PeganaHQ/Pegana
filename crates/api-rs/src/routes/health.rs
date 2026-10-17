//! Liveness + readiness probes — plus a tiny root discovery document so
//! `GET https://api.pegana.xyz/` returns something useful instead of 404.

use crate::error::ApiError;
use crate::AppState;
use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Arc;
use utoipa::ToSchema;

#[utoipa::path(
    get,
    path = "/",
    tag = "Health",
    summary = "API index + version",
    responses(
        (status = 200, description = "Endpoint index + version", body = serde_json::Value),
        (status = 429, description = "Rate limit exceeded — see Retry-After header", body = ApiError)
    )
)]
pub async fn root() -> Json<Value> {
    Json(json!({
        "name": "pegana-api",
        "version": "v1",
        "endpoints": {
            "stats":      "/v1/stats",
            "assets":     "/v1/assets",
            "peg_feed":   "/v1/peg/feed",
            "audit":      "/v1/audit",
            "ws":         "/v1/ws",
            "health":     "/healthz",
            "ready":      "/readyz",
            "openapi":     "/openapi.json",
            "webhook_ips":  "/v1/meta/webhook-ips",
            "webhook_keys": "/v1/meta/webhook-keys"
        }
    }))
}

#[derive(Serialize, ToSchema)]
pub struct WebhookKeysResponse {
    /// Base64-encoded Ed25519 public keys currently signing outbound
    /// webhooks. Index 0 is the **primary** (every new delivery is
    /// signed with this); index 1 (when present) is the **secondary**,
    /// active only during a rotation window. Receivers should trust
    /// ANY of the listed keys when verifying `x-pegana-signature`.
    pub pubkeys_b64: Vec<String>,
    /// Hint to refresh weekly — during a rotation this list flips
    /// from `[A]` → `[A, B]` → `[B]` over the rotation window. Polling
    /// at least once between deploys is enough to follow it.
    #[serde(serialize_with = "crate::serde_fmt::ts_millis_z")]
    pub recheck_after: chrono::DateTime<chrono::Utc>,
}

/// GET /v1/meta/webhook-keys — active Ed25519 public keys for verifying
/// inbound webhook signatures.
///
/// Lifted from the GitHub pattern (`GET /meta` with `ssh_keys`).
/// During key rotation we publish BOTH the outgoing primary AND the
/// incoming secondary here, so receivers can pre-trust the new key
/// before we cut over. See `pegana_common::webhook_sign` for the
/// full rotation playbook.
#[utoipa::path(
    get,
    path = "/v1/meta/webhook-keys",
    tag = "Health",
    responses(
        (status = 200, description = "Active webhook-signer public keys", body = WebhookKeysResponse),
        (status = 429, description = "Rate limit exceeded — see Retry-After header", body = ApiError)
    )
)]
pub async fn webhook_keys() -> Json<WebhookKeysResponse> {
    let pubkeys_b64 = pegana_common::webhook_sign::SigningKeys::from_env()
        .map(|k| k.pubkeys_b64())
        .unwrap_or_default();
    Json(WebhookKeysResponse {
        pubkeys_b64,
        recheck_after: chrono::Utc::now() + chrono::Duration::days(7),
    })
}

#[derive(Serialize, ToSchema)]
pub struct WebhookIpsResponse {
    /// IPv4 / IPv6 addresses Pegana POSTs from when delivering webhooks.
    /// Subscribers running zero-trust ingress can allowlist these.
    pub ips: Vec<String>,
    /// Hint to refresh this list weekly — IPs can change without notice
    /// during infrastructure migrations.
    #[serde(serialize_with = "crate::serde_fmt::ts_millis_z")]
    pub recheck_after: chrono::DateTime<chrono::Utc>,
}

/// GET /v1/meta/webhook-ips — IP allowlist hint for webhook subscribers.
///
/// Pattern lifted from Linear (`6 static IPs` page) and GitHub
/// (`GET /meta` with `hooks` field). Subscribers behind enterprise
/// firewalls need to know which source IPs to trust; without this
/// they either disable signature-based trust or refuse our deliveries.
///
/// Source of truth is the `PEGANA_WEBHOOK_EGRESS_IPS` env var
/// (comma-separated). No hardcoded default: the deployment env supplies
/// the egress IP(s), so the public repo never carries infra addresses.
#[utoipa::path(
    get,
    path = "/v1/meta/webhook-ips",
    tag = "Health",
    responses(
        (status = 200, description = "Webhook egress IP allowlist", body = WebhookIpsResponse),
        (status = 429, description = "Rate limit exceeded — see Retry-After header", body = ApiError)
    )
)]
pub async fn webhook_ips() -> Json<WebhookIpsResponse> {
    let ips_env = std::env::var("PEGANA_WEBHOOK_EGRESS_IPS").unwrap_or_default();
    let ips: Vec<String> = ips_env
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    Json(WebhookIpsResponse {
        ips,
        recheck_after: chrono::Utc::now() + chrono::Duration::days(7),
    })
}

#[derive(Serialize, ToSchema)]
pub struct LiveResponse {
    /// Always "ok" when the binary is up.
    pub status: &'static str,
    /// Seconds since the process started.
    pub uptime_secs: i64,
}

#[utoipa::path(
    get,
    path = "/healthz",
    tag = "Health",
    summary = "Liveness probe",
    responses(
        (status = 200, description = "Liveness probe — process is up", body = LiveResponse),
        (status = 500, description = "Unexpected server error", body = ApiError)
    )
)]
pub async fn live(State(state): State<Arc<AppState>>) -> Json<LiveResponse> {
    Json(LiveResponse {
        status: "ok",
        uptime_secs: (chrono::Utc::now() - state.started_at).num_seconds(),
    })
}

#[derive(Serialize, ToSchema)]
pub struct SourceFreshness {
    /// Seconds since the most recent `intrinsic_snapshots` row written by
    /// the Sanctum LST adapter (`source LIKE 'sanctum%'`). `None` means no
    /// row yet — cold start, or the source has never come up.
    pub sanctum_secs: Option<i64>,
    /// Seconds since the most recent `market_snapshots` row. Jupiter is the
    /// primary writer; dexscreener fallback also lands here.
    pub jupiter_secs: Option<i64>,
    /// Seconds since the most recent `oracle_snapshots.publish_time` (Pyth
    /// SSE stream).
    pub pyth_secs: Option<i64>,
    /// Seconds since the most recent `hylo_state_snapshots` row (Hylo
    /// Exchange CR + reserve snapshot).
    pub hylo_secs: Option<i64>,
}

#[derive(Serialize, ToSchema)]
pub struct ReadyResponse {
    /// "ready" if all downstream deps are healthy; "not_ready" otherwise.
    pub status: &'static str,
    /// SELECT 1 on Postgres succeeded.
    pub db: bool,
    /// PING on Redis returned PONG.
    pub redis: bool,
    /// Seconds since the most recent `discount_snapshots.ts`. `None` if no
    /// snapshots exist yet.
    pub last_snapshot_age_secs: Option<i64>,
    /// Per-source freshness so /status can render each row with its own
    /// honest age instead of mirroring the global discount timestamp.
    pub sources: SourceFreshness,
}

#[utoipa::path(
    get,
    path = "/readyz",
    tag = "Health",
    summary = "Readiness probe",
    responses(
        (status = 200, description = "All downstream deps healthy", body = ReadyResponse),
        (status = 503, description = "DB, Redis, or snapshot age unhealthy", body = ReadyResponse)
    )
)]
pub async fn ready(State(state): State<Arc<AppState>>) -> (StatusCode, Json<ReadyResponse>) {
    let db_ok = sqlx::query("SELECT 1").fetch_one(&state.pg).await.is_ok();

    // Five max(ts) probes run in parallel on the shared pool — the per-table
    // hypertable index makes each one a microsecond seek. Failures collapse
    // to `None` so a missing table or transient error degrades gracefully
    // instead of failing the whole probe.
    type TsRow = (chrono::DateTime<chrono::Utc>,);
    let (discount, sanctum, jupiter, pyth, hylo) = tokio::join!(
        sqlx::query_as::<_, TsRow>("SELECT max(ts) FROM discount_snapshots")
            .fetch_optional(&state.pg),
        sqlx::query_as::<_, TsRow>(
            "SELECT max(ts) FROM intrinsic_snapshots WHERE source LIKE 'sanctum%'",
        )
        .fetch_optional(&state.pg),
        sqlx::query_as::<_, TsRow>("SELECT max(ts) FROM market_snapshots")
            .fetch_optional(&state.pg),
        sqlx::query_as::<_, TsRow>("SELECT max(publish_time) FROM oracle_snapshots")
            .fetch_optional(&state.pg),
        sqlx::query_as::<_, TsRow>("SELECT max(ts) FROM hylo_state_snapshots")
            .fetch_optional(&state.pg),
    );

    let now = chrono::Utc::now();
    let age_secs = |r: Result<Option<TsRow>, sqlx::Error>| {
        r.ok().flatten().map(|(t,)| (now - t).num_seconds())
    };

    let discount_age = age_secs(discount);
    let sources = SourceFreshness {
        sanctum_secs: age_secs(sanctum),
        jupiter_secs: age_secs(jupiter),
        pyth_secs: age_secs(pyth),
        hylo_secs: age_secs(hylo),
    };

    let redis_ok = match state.redis.get_multiplexed_async_connection().await {
        Ok(mut conn) => redis::cmd("PING")
            .query_async::<String>(&mut conn)
            .await
            .map(|r| r == "PONG")
            .unwrap_or(false),
        Err(_) => false,
    };

    let healthy = db_ok && redis_ok && discount_age.map(|a| a < 120).unwrap_or(false);
    let code = if healthy {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        code,
        Json(ReadyResponse {
            status: if healthy { "ready" } else { "not_ready" },
            db: db_ok,
            redis: redis_ok,
            last_snapshot_age_secs: discount_age,
            sources,
        }),
    )
}
