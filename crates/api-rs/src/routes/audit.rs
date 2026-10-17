//! /v1/audit/* — public receipts for alerts (Trust Layer v0.1.0 Phase 4).
//!
//! 5 read-only endpoints serving the receipt JSON, replay bundles, on-chain
//! commit pointers, recent-audit index, and streaming CSV export. All
//! endpoints are public (no auth) and cache-friendly.
//!
//! ## ADR conformance
//!
//! - **ADR-0006**: `GET /v1/audit/:alert_id` is the user-visible side of the
//!   alert-evidence persistence-failure policy. It distinguishes four states:
//!   `200` (receipt row exists in `alert_evidence`, canonical success),
//!   `202` (row only in `alert_evidence_pending`, retry still active; body
//!   carries `retry_after_seconds: 60` so polling clients back off),
//!   `410` (row in `alert_evidence_pending` with `failed_permanently_at`
//!   set; the receipt will never land — body carries `last_error` and
//!   `alert_dispatched_at` for triage),
//!   `404` (genuinely unknown `alert_id`, no row in either table).
//!   This preserves the trust narrative: we never 404 an alert that was
//!   actually dispatched. See `docs/adr/0006-alert-evidence-persistence-failure.md`.
//!
//! - **ADR-0014**: per-endpoint bounds documented as part of the public API
//!   contract so SDK clients code to them from day one. `/v1/audit.csv` is
//!   capped at a 90-day window and 50k rows per response; `/v1/audit` index
//!   `limit` is clamped to 100 (was 200 in original spec). Per-route
//!   rate-limit middleware lands in Wave 4B/4C.
//!   See `docs/adr/0014-csv-index-rate-limits.md`.

use crate::extract::ValQuery;
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
// `StreamBodyAs::csv()` and every other convenience constructor in axum-streams
// 0.19 hardcode `CsvStreamFormat::new(false, b',')` — has_headers = FALSE. That
// silently shipped a headerless CSV, so pandas/Excel/csv.DictReader consumed the
// first DATA row as the column names on the export framed as the compliance
// artifact. `with_options` is the only way to turn the header row on.
use axum_streams::{CsvStreamFormat, StreamBodyAs, StreamBodyAsOptions};
use chrono::{DateTime, Utc};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use std::sync::Arc;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

/// Receipt JSON is content-addressed by `receipt_sha256`; an `alert_id`'s
/// receipt never changes after first write. `immutable` instructs caches
/// (browser, Caddy, CDN) to skip revalidation for a year.
const IMMUTABLE_CACHE: &str = "public, max-age=31536000, immutable";

/// 500 with opaque body + tracing log. Mirrors the helper used in every
/// other route module — never surface `sqlx::Error` strings on the wire.
fn db_error<E: std::fmt::Debug>(e: E) -> (StatusCode, Json<serde_json::Value>) {
    tracing::error!(?e, "audit endpoint db error");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": "internal"})),
    )
}

// ─── Response schemas (for OpenAPI; bodies are still serialized via
// `serde_json::Value` to keep the LEFT JOIN optional-field handling simple). ──

/// The `alert` object inside a 200 receipt body (`GET /v1/audit/{alert_id}`).
/// Decimal money fields are JSON strings (preserves precision).
#[derive(Debug, Serialize, ToSchema)]
pub struct AuditAlert {
    /// Alert UUID.
    pub id: String,
    pub asset: String,
    pub class: String,
    #[schema(value_type = crate::schema::PegState)]
    pub from_state: String,
    #[schema(value_type = crate::schema::PegState)]
    pub to_state: String,
    /// Signed discount fraction at detection, as a decimal string.
    pub discount: String,
    pub intrinsic_usd: String,
    pub market_usd: String,
    #[schema(value_type = crate::schema::Confidence)]
    pub confidence: String,
    pub detected_at: DateTime<Utc>,
}

/// The `evidence` object inside a 200 receipt body — the frozen inputs and
/// methodology pin that make the alert independently verifiable.
#[derive(Debug, Serialize, ToSchema)]
pub struct AuditEvidence {
    pub methodology_version: String,
    pub methodology_git_sha: Option<String>,
    pub assets_toml_sha256: String,
    /// Verbatim frozen inputs snapshot (shape depends on methodology version).
    pub inputs_frozen: serde_json::Value,
    /// Verbatim computed intermediates.
    pub computed: serde_json::Value,
    pub has_replay_artifact: bool,
    pub receipt_sha256: String,
    pub onchain_tx_sig: Option<String>,
    /// `not_applicable` | `pending` | `committed` | `retry_exhausted` | `wallet_drained`.
    pub commit_status: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Receipt envelope returned by `GET /v1/audit/{alert_id}` with a 200 (the
/// `alert_evidence` row exists). The runtime body is assembled via `json!` for
/// LEFT-JOIN flexibility; these structs mirror it field-for-field so
/// `/openapi.json` documents the REAL shape instead of two opaque objects. Kept
/// in lockstep with the `json!` body manually — the 202/410 responses use a
/// different shape (see the endpoint's other documented responses).
#[derive(Debug, Serialize, ToSchema)]
pub struct AuditDetailResponse {
    pub alert: AuditAlert,
    pub evidence: AuditEvidence,
    /// Always `"ready"` on a 200.
    pub evidence_status: String,
}

/// 202 body for `GET /v1/audit/{alert_id}` — receipt persistence is still
/// retrying (ADR-0006). Poll again after `retry_after_seconds`.
#[derive(Debug, Serialize, ToSchema)]
pub struct AuditPendingResponse {
    /// Always `"pending"`.
    pub status: String,
    pub alert_id: String,
    /// When the alert was dispatched (the dead-letter `queued_at`).
    pub alert_dispatched_at: DateTime<Utc>,
    /// Suggested back-off before re-polling.
    pub retry_after_seconds: i64,
    /// Always `"pending"`.
    pub evidence_status: String,
}

/// 410 body for `GET /v1/audit/{alert_id}` — receipt persistence failed
/// permanently (ADR-0006 dead-letter terminal); the receipt will never land.
#[derive(Debug, Serialize, ToSchema)]
pub struct AuditGoneResponse {
    /// Always `"persistence_failed"`.
    pub status: String,
    pub alert_id: String,
    /// When the alert was dispatched (the dead-letter `queued_at`).
    pub alert_dispatched_at: DateTime<Utc>,
    /// Last persistence error recorded, if any.
    pub last_error: Option<String>,
    /// Always `"failed_permanent"`.
    pub evidence_status: String,
}

/// On-chain commit pointer.
#[derive(Debug, Serialize, ToSchema)]
pub struct OnchainResponse {
    pub tx_sig: String,
    pub explorer_url: String,
    /// Always `"committed"` on a 200 — present so a caller can branch on the
    /// same `commit_status` vocabulary the 404 body uses (ADR-0004).
    pub commit_status: String,
}

/// One row of the `GET /v1/audit` index array.
#[derive(Debug, Serialize, ToSchema)]
pub struct AuditIndexRow {
    pub id: String,
    pub asset: String,
    #[schema(value_type = crate::schema::PegState)]
    pub from_state: String,
    #[schema(value_type = crate::schema::PegState)]
    pub to_state: String,
    pub detected_at: DateTime<Utc>,
    pub methodology_version: String,
    pub receipt_sha256: String,
    pub onchain_tx_sig: Option<String>,
    /// True for a released `monitoring_only` (beta) asset — provisional
    /// calibration. Present at runtime since the beta release; this field
    /// re-aligns the documented schema with the wire (it was emitted but not
    /// declared). Always present.
    pub monitoring_only: bool,
    /// Self-describing form of `monitoring_only`, `provisional` | `calibrated`
    /// — same vocabulary as the webhook canonical event. Always present.
    #[schema(value_type = crate::schema::Calibration)]
    pub calibration: String,
}

/// One row of the streaming CSV from `GET /v1/audit.csv`. axum-streams
/// derives header + row encoding from `serde::Serialize`.
#[derive(Debug, Serialize, ToSchema)]
pub struct AuditCsvRow {
    pub alert_id: String,
    pub asset: String,
    pub class: String,
    #[schema(value_type = crate::schema::PegState)]
    pub from_state: String,
    #[schema(value_type = crate::schema::PegState)]
    pub to_state: String,
    pub discount: String,
    pub intrinsic_usd: String,
    pub market_usd: String,
    #[schema(value_type = crate::schema::Confidence)]
    pub confidence: String,
    pub detected_at: String,
    pub methodology_version: String,
    pub assets_toml_sha256: String,
    pub receipt_sha256: String,
    pub onchain_tx_sig: Option<String>,
}

// ─── GET /v1/audit/:alert_id ─────────────────────────────────────────────

/// `GET /v1/audit/{alert_id}` — single receipt with ADR-0006 four-state
/// discrimination.
///
/// Returns `Response` (not `Json`) so each status path can carry distinct
/// headers and body without fighting axum's `Result<T, E>` → IntoResponse
/// conversion (which forces non-2xx into the `Err` arm).
#[utoipa::path(
    get,
    path = "/v1/audit/{alert_id}",
    tag = "audit",
    operation_id = "audit_detail",
    params(
        ("alert_id" = String, Path, description = "Alert UUID")
    ),
    responses(
        (status = 200, description = "Receipt JSON (alert + evidence wrapper)", body = AuditDetailResponse),
        (status = 202, description = "Evidence persistence pending (ADR-0006); body carries retry_after_seconds", body = AuditPendingResponse),
        (status = 400, description = "Invalid UUID format"),
        (status = 404, description = "Unknown alert_id (no row in alert_evidence or alert_evidence_pending)"),
        (status = 410, description = "Evidence persistence failed permanently (ADR-0006); receipt will never materialize", body = AuditGoneResponse),
    )
)]
pub async fn detail(
    State(state): State<Arc<AppState>>,
    Path(alert_id): Path<String>,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let id = Uuid::parse_str(&alert_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "invalid_uuid"})),
        )
    })?;

    // Path 1: receipt row exists in alert_evidence. Canonical success.
    let row = sqlx::query(
        r#"SELECT a.id, a.asset, a.class::text AS class,
                  a.from_state::text AS from_state, a.to_state::text AS to_state,
                  a.discount, a.intrinsic_usd, a.market_usd,
                  a.confidence::text AS confidence, a.detected_at,
                  e.methodology_version, e.methodology_git_sha, e.assets_toml_sha256,
                  e.inputs_frozen, e.computed, e.replay_artifact, e.receipt_sha256,
                  e.onchain_tx_sig, e.commit_status, e.created_at AS evidence_at
           FROM alerts a
           JOIN alert_evidence e ON e.alert_id = a.id
           WHERE a.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.pg)
    .await
    .map_err(db_error)?;

    if let Some(row) = row {
        let has_replay = !row
            .try_get::<Option<serde_json::Value>, _>("replay_artifact")
            .ok()
            .flatten()
            .unwrap_or(serde_json::Value::Null)
            .is_null();
        let body = json!({
            "alert": {
                "id": row.get::<Uuid, _>("id").to_string(),
                "asset": row.get::<String, _>("asset"),
                "class": row.get::<String, _>("class"),
                "from_state": row.get::<String, _>("from_state"),
                "to_state": row.get::<String, _>("to_state"),
                "discount": row.get::<rust_decimal::Decimal, _>("discount").to_string(),
                "intrinsic_usd": row.get::<rust_decimal::Decimal, _>("intrinsic_usd").to_string(),
                "market_usd": row.get::<rust_decimal::Decimal, _>("market_usd").to_string(),
                "confidence": row.get::<String, _>("confidence"),
                "detected_at": crate::serde_fmt::rfc3339_millis_z(&row.get::<DateTime<Utc>, _>("detected_at")),
            },
            "evidence": {
                "methodology_version": row.get::<String, _>("methodology_version"),
                "methodology_git_sha": row.try_get::<Option<String>, _>("methodology_git_sha").ok().flatten(),
                "assets_toml_sha256": row.get::<String, _>("assets_toml_sha256"),
                "inputs_frozen": row.get::<serde_json::Value, _>("inputs_frozen"),
                "computed": row.get::<serde_json::Value, _>("computed"),
                "has_replay_artifact": has_replay,
                "receipt_sha256": row.get::<String, _>("receipt_sha256"),
                "onchain_tx_sig": row.try_get::<Option<String>, _>("onchain_tx_sig").ok().flatten(),
                // commit_status: not_applicable | pending | committed | retry_exhausted | wallet_drained
                // (per migration 0033 + ADR-0004). Drift transitions land as
                // not_applicable because on-chain SPL Memo commit is cost-gated
                // to {Depeg, Critical, BlackSwan}. Without this field the UI can't
                // distinguish "anchoring in progress" from "anchoring intentionally skipped".
                "commit_status": row.try_get::<Option<String>, _>("commit_status").ok().flatten(),
                "created_at": crate::serde_fmt::rfc3339_millis_z(&row.get::<DateTime<Utc>, _>("evidence_at")),
            },
            "evidence_status": "ready",
        });
        let mut headers = HeaderMap::new();
        headers.insert(header::CACHE_CONTROL, IMMUTABLE_CACHE.parse().unwrap());
        return Ok((StatusCode::OK, headers, Json(body)).into_response());
    }

    // Path 2 / 3: receipt missing — check the dead-letter queue (ADR-0006).
    // Tuple: (failed_permanently_at, last_error, queued_at). queued_at is
    // NOT NULL in the schema (DEFAULT NOW()); the others are nullable.
    type PendingRow = (Option<DateTime<Utc>>, Option<String>, DateTime<Utc>);
    let pending: Option<PendingRow> = sqlx::query_as(
        "SELECT failed_permanently_at, last_error, queued_at \
         FROM alert_evidence_pending \
         WHERE alert_id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pg)
    .await
    .map_err(db_error)?;

    if let Some((failed_at, last_err, queued_at)) = pending {
        if failed_at.is_some() {
            // Terminal: 410 Gone. The receipt will never materialize.
            let body = json!({
                "status": "persistence_failed",
                "alert_id": alert_id,
                "alert_dispatched_at": crate::serde_fmt::rfc3339_millis_z(&queued_at),
                "last_error": last_err,
                "evidence_status": "failed_permanent",
            });
            return Ok((StatusCode::GONE, Json(body)).into_response());
        }
        // Retry still active: 202 Accepted. Polling clients back off via
        // retry_after_seconds. The dead-letter retry worker runs every 30s
        // (see ADR-0006); 60s is a comfortable jittered interval.
        let body = json!({
            "status": "pending",
            "alert_id": alert_id,
            "alert_dispatched_at": crate::serde_fmt::rfc3339_millis_z(&queued_at),
            "retry_after_seconds": 60,
            "evidence_status": "pending",
        });
        let mut headers = HeaderMap::new();
        headers.insert(header::RETRY_AFTER, "60".parse().unwrap());
        return Ok((StatusCode::ACCEPTED, headers, Json(body)).into_response());
    }

    // Path 4: receipt + pending both missing. Distinguish two sub-cases for
    // a more honest 404 message:
    //   - alerts row exists but no evidence/pending → "evidence_missing"
    //     (edge case: push_alert failed BOTH the alert_evidence INSERT and
    //     the alert_evidence_pending fallback INSERT — extremely rare)
    //   - alerts row absent → "alert_not_found" (the alert_id was never
    //     observed by the engine)
    let alert_exists: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM alerts WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pg)
        .await
        .map_err(db_error)?;
    if alert_exists.is_some() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": "evidence_missing",
                "alert_id": alert_id,
                "hint": "alert row exists but neither alert_evidence nor alert_evidence_pending has a matching row (push_alert audit + fallback both failed); check Sentry"
            })),
        ));
    }
    Err((
        StatusCode::NOT_FOUND,
        Json(json!({"error": "alert_not_found", "alert_id": alert_id})),
    ))
}

// ─── GET /v1/audit/:alert_id/replay-bundle ───────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/audit/{alert_id}/replay-bundle",
    tag = "audit",
    summary = "Download an alert's replay bundle",
    params(
        ("alert_id" = String, Path, description = "Alert UUID")
    ),
    responses(
        (status = 200, description = "Replay bundle JSON (Content-Disposition: attachment)"),
        (status = 400, description = "Invalid UUID format"),
        (status = 404, description = "No replay artifact (DRIFT alerts) or unknown alert_id"),
    )
)]
pub async fn replay_bundle(
    State(state): State<Arc<AppState>>,
    Path(alert_id): Path<String>,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let id = Uuid::parse_str(&alert_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "invalid_uuid"})),
        )
    })?;
    let bundle: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT replay_artifact FROM alert_evidence WHERE alert_id = $1")
            .bind(id)
            .fetch_optional(&state.pg)
            .await
            .map_err(db_error)?
            .flatten();

    let bundle = bundle.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": "no_replay_artifact",
                "alert_id": alert_id,
                "hint": "DRIFT alerts have no artifact; receipt available at /v1/audit/<id>"
            })),
        )
    })?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"alert-{alert_id}.json\"")
            .parse()
            .unwrap(),
    );
    headers.insert(header::CACHE_CONTROL, IMMUTABLE_CACHE.parse().unwrap());
    Ok((StatusCode::OK, headers, Json(bundle)).into_response())
}

// ─── GET /v1/audit/:alert_id/onchain ─────────────────────────────────────

#[utoipa::path(
    get,
    path = "/v1/audit/{alert_id}/onchain",
    tag = "audit",
    summary = "Get an alert's on-chain commit pointer",
    params(
        ("alert_id" = String, Path, description = "Alert UUID")
    ),
    responses(
        (status = 200, description = "On-chain commit pointer", body = OnchainResponse),
        (status = 400, description = "Invalid UUID format"),
        (status = 404, description = "Not anchored — stays 404 across ALL non-committed states \
            by design (clients such as `pegana-replay --verify-onchain` treat 404 as 'skip the \
            on-chain check'). Body `error` discriminates the reason: `not_applicable` \
            (cost-gated, never anchored — ADR-0004), `not_committed_yet` (in-flight, queued, or \
            unknown alert), `retry_exhausted`, `wallet_drained`, or `persistence_failed` \
            (ADR-0006 dead-letter terminal — the same state /detail returns as 410)."),
    )
)]
pub async fn onchain(
    State(state): State<Arc<AppState>>,
    Path(alert_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let id = Uuid::parse_str(&alert_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "invalid_uuid"})),
        )
    })?;
    // Read commit_status alongside the signature so a NULL tx_sig can be
    // explained, not collapsed into a single "not_committed_yet" (B-005 / ADR-0004).
    // commit_status is NOT NULL since migration 0033 (DEFAULT 'not_applicable',
    // backfilled across all rows); the `Option`/`"unknown"` fallback below is
    // defense against schema drift or an unmapped future enum value, never a
    // real NULL on a current row.
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT onchain_tx_sig, commit_status FROM alert_evidence WHERE alert_id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pg)
    .await
    .map_err(db_error)?;

    let (sig, status) = match row {
        // No alert_evidence row — the receipt never materialized. Before
        // reporting a bare "not yet", consult the ADR-0006 dead-letter queue so
        // /onchain agrees with /detail on the MEANING of this alert's state
        // (B-005): a permanently-failed persistence must not read as "try
        // again". HTTP stays 404 across all of these by design — the dead-letter
        // status surfaces through `commit_status`/`error`, never a status-code
        // change — because `pegana-replay --verify-onchain` treats 404 as "skip
        // the on-chain check" and a 410/202 here would break that contract
        // (/detail, which has no such consumer, does return 410/202).
        None => {
            let pending: Option<(Option<DateTime<Utc>>, Option<String>)> = sqlx::query_as(
                "SELECT failed_permanently_at, last_error \
                 FROM alert_evidence_pending WHERE alert_id = $1",
            )
            .bind(id)
            .fetch_optional(&state.pg)
            .await
            .map_err(db_error)?;
            let (error, commit_status, detail) = match pending {
                // Terminal: the receipt — and therefore the on-chain anchor —
                // will never materialize. /detail reports this as 410 Gone.
                Some((Some(_failed_at), last_err)) => (
                    "persistence_failed",
                    "failed_permanent",
                    last_err.unwrap_or_else(|| {
                        "Receipt persistence failed permanently (ADR-0006 dead-letter); \
                         the on-chain commit will never be attempted."
                            .to_string()
                    }),
                ),
                // Still retrying: the receipt hasn't landed, so neither has the
                // anchor. Genuinely in-flight — /detail reports this as 202.
                Some((None, _)) => (
                    "not_committed_yet",
                    "pending_persistence",
                    "Receipt persistence is still retrying (ADR-0006 dead-letter); \
                     the on-chain commit is queued behind it."
                        .to_string(),
                ),
                // No receipt and no dead-letter row: unknown alert, or the
                // engine dispatch hasn't been observed yet.
                None => (
                    "not_committed_yet",
                    "unknown",
                    "No evidence row for this alert — unknown alert_id, or the \
                     receipt has not been persisted yet."
                        .to_string(),
                ),
            };
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({
                    "error": error,
                    "commit_status": commit_status,
                    "detail": detail,
                    "alert_id": alert_id,
                })),
            ));
        }
        Some((sig, status)) => (sig, status.unwrap_or_else(|| "unknown".to_string())),
    };

    // Committed: the signature is present.
    if let Some(sig) = sig {
        return Ok(Json(json!({
            "tx_sig": sig,
            "explorer_url": format!("https://solscan.io/tx/{sig}"),
            "commit_status": "committed",
        })));
    }

    // No signature — discriminate WHY via commit_status (ADR-0004). All of these
    // stay 404 so existing clients (e.g. pegana-replay --verify-onchain, which
    // treats 404 as "skip on-chain check") keep working; only the `error`
    // discriminator and the additive `detail`/`commit_status` fields change.
    let (error, detail) = match status.as_str() {
        // Non-critical (Drift) transition: on-chain SPL Memo anchoring is
        // intentionally NEVER attempted (cost-gated to {Depeg, Critical,
        // BlackSwan}). This will never become committed — distinct from "not yet".
        "not_applicable" => (
            "not_applicable",
            "No on-chain anchor for this alert. The usual cause is the ADR-0004 cost gate: \
             SPL Memo commits are reserved for high-severity transitions \
             (Depeg/Critical/BlackSwan), so Drift transitions are never anchored. (If \
             on-chain commits are disabled operator-side — e.g. no commit keypair — a \
             higher-severity alert can also land here.) The receipt is still \
             cryptographically verifiable offline either way.",
        ),
        // Genuinely in-flight: the commit worker has the receipt queued.
        "pending" => (
            "not_committed_yet",
            "On-chain commit is in progress; poll again shortly.",
        ),
        "retry_exhausted" => (
            "retry_exhausted",
            "On-chain commit retries were exhausted (ADR-0006). The receipt is still \
             verifiable offline; only the Solana anchor is missing.",
        ),
        "wallet_drained" => (
            "wallet_drained",
            "On-chain commit paused: the operator wallet ran out of SOL (ADR-0004).",
        ),
        // 'committed' with a NULL sig shouldn't happen; 'unknown' = pre-0033 row.
        _ => (
            "not_committed_yet",
            "No on-chain commit signature recorded for this alert.",
        ),
    };
    Err((
        StatusCode::NOT_FOUND,
        Json(json!({
            "error": error,
            "commit_status": status,
            "detail": detail,
            "alert_id": alert_id,
        })),
    ))
}

// ─── GET /v1/audit (index) ──────────────────────────────────────────────

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct IndexParams {
    /// Page size. Default 50, clamped to 100 per ADR-0014.
    pub limit: Option<u32>,
    /// When true (default), filter out `PEGGED` end-state rows. PEGGED is
    /// the "recovered" state — usually noise from the index perspective.
    pub exclude_pegged: Option<bool>,
    /// Server-side filter on the to_state value. Closes AC42 — the
    /// previous client-side filter on the web/audit page was correct in
    /// shape but constrained to whatever batch the index returned (default
    /// 50 rows). With server filtering the full limit applies to matching
    /// rows. Valid values: PEGGED, DRIFT, DEPEG, CRITICAL, BLACK_SWAN.
    /// Any other value yields HTTP 400 with `error: invalid_state`.
    pub state: Option<String>,
}

/// Accepted values for the optional `?state=` filter on `GET /v1/audit`.
/// Matches the `peg_state` Postgres ENUM. UNKNOWN is excluded — it's a
/// startup sentinel, not a queryable end state.
const VALID_AUDIT_STATES: &[&str] = &["PEGGED", "DRIFT", "DEPEG", "CRITICAL", "BLACK_SWAN"];

#[utoipa::path(
    get,
    path = "/v1/audit",
    tag = "audit",
    summary = "List recent audit receipts",
    params(IndexParams),
    responses(
        (status = 200, description = "Index of recent audits, newest first", body = Vec<AuditIndexRow>),
        (status = 400, description = "Invalid ?state= value (must be one of PEGGED|DRIFT|DEPEG|CRITICAL|BLACK_SWAN)"),
    )
)]
pub async fn index(
    State(state): State<Arc<AppState>>,
    ValQuery(q): ValQuery<IndexParams>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, Json<serde_json::Value>)> {
    // ADR-0014: cap at 100 (was 200 in the original spec) to keep this
    // endpoint a cheap "small page" the global 300/min rate limit suffices for.
    let limit = q.limit.unwrap_or(50).min(100);
    let exclude_pegged = q.exclude_pegged.unwrap_or(true);

    // Validate the optional state filter against the canonical enum.
    // Postgres would also reject an unknown value via the ::text comparison
    // but we want a structured 400 instead of a 500. Done BEFORE the
    // ADR-0020 launch-flag gate below so the input-validation contract
    // (400 on a bogus ?state=) holds regardless of the flag — a 400 leaks
    // nothing about whether the ledger has rows.
    let state_filter: Option<&str> = match q.state.as_deref() {
        None => None,
        Some(s) if VALID_AUDIT_STATES.contains(&s) => Some(s),
        Some(other) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "invalid_state",
                    "got": other,
                    "valid": VALID_AUDIT_STATES,
                })),
            ));
        }
    };

    // ADR-0020: the discoverable INDEX (and the RSS/Atom/CSV feeds that call
    // it) is gated on FEATURE_PUBLIC_ALERTS. During the calibration window
    // (flag false) the ledger must not be publicly enumerable, so we return
    // an empty list — the web `/audit` page falls into its existing
    // AuditEmptyState(kind="calibration"). Direct receipt lookups
    // (/v1/audit/{id}, /onchain, /replay-bundle) stay ungated. The 06-11
    // launch flips the flag and reveals the index across all consumers.
    if !state.feature_public_alerts {
        return Ok(Json(Vec::new()));
    }

    let rows = sqlx::query(
        r#"SELECT a.id, a.asset, a.from_state::text AS from_state,
                  a.to_state::text AS to_state, a.detected_at,
                  e.methodology_version, e.receipt_sha256, e.onchain_tx_sig,
                  -- Beta cohort: monitoring_only assets are now INDEXED (no
                  -- longer egress-gated) but flagged provisional. Correlated
                  -- subquery → no bind shift.
                  COALESCE(
                    (SELECT (m.metadata->>'monitoring_only')::boolean
                     FROM assets m WHERE m.symbol = a.asset), FALSE) AS monitoring_only
           FROM alerts a JOIN alert_evidence e ON e.alert_id = a.id
           WHERE ($1 = false OR a.to_state <> 'PEGGED')
             AND ($3::text IS NULL OR a.to_state::text = $3::text)
           ORDER BY a.detected_at DESC LIMIT $2"#,
    )
    .bind(exclude_pegged)
    .bind(limit as i64)
    .bind(state_filter)
    .fetch_all(&state.pg)
    .await
    .map_err(db_error)?;

    let body: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|row| {
            let monitoring_only = row.try_get::<bool, _>("monitoring_only").unwrap_or(false);
            json!({
                "id": row.get::<Uuid, _>("id").to_string(),
                "asset": row.get::<String, _>("asset"),
                "from_state": row.get::<String, _>("from_state"),
                "to_state": row.get::<String, _>("to_state"),
                "detected_at": crate::serde_fmt::rfc3339_millis_z(&row.get::<DateTime<Utc>, _>("detected_at")),
                "methodology_version": row.get::<String, _>("methodology_version"),
                "receipt_sha256": row.get::<String, _>("receipt_sha256"),
                "onchain_tx_sig": row.try_get::<Option<String>, _>("onchain_tx_sig").ok().flatten(),
                "monitoring_only": monitoring_only,
                "calibration": crate::schema::calibration_label(monitoring_only),
            })
        })
        .collect();
    Ok(Json(body))
}

// ─── GET /v1/audit.csv (streaming) ──────────────────────────────────────

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CsvParams {
    /// Lower bound (inclusive) on `detected_at`. ISO-8601 / RFC-3339.
    pub from: DateTime<Utc>,
    /// Upper bound (inclusive) on `detected_at`. Max 90 days from `from`
    /// per ADR-0014.
    pub to: DateTime<Utc>,
    /// Optional asset symbol filter (e.g. `USDe`). Recommended for large
    /// ranges.
    pub asset: Option<String>,
}

/// ADR-0014 max-row cap. Once the running yield count hits this, the stream
/// terminates. CSV trailers can't be written after the body has flushed, so we
/// cannot surface an `X-Truncated` header inline — instead any truncation is
/// COUNTED (`pegana_audit_csv_truncated_total{reason}`) so it is observable to
/// operators rather than silent (#R4-1). Two reasons: `row_cap` (this 50k cap)
/// and `query_error` (a transient mid-stream Postgres failure, also
/// Sentry-captured). A future buffered handler can layer in `X-Truncated` /
/// `Link: <next>` for inline client signalling.
const CSV_MAX_ROWS: usize = 50_000;

/// Internal cursor page size. Keeps Postgres result sets bounded while the
/// stream is in flight.
const CSV_PAGE: i64 = 1_000;

#[utoipa::path(
    get,
    path = "/v1/audit.csv",
    tag = "audit",
    summary = "Export audit receipts as CSV",
    params(CsvParams),
    responses(
        (status = 200, description = "Streaming CSV export (chunked transfer encoding); max 50k rows per ADR-0014"),
        (status = 400, description = "Invalid date range (> 90 days per ADR-0014) or missing parameters"),
        (status = 429, description = "Rate limit exceeded — 10/min on this endpoint (ADR-0014), 300/min global; Retry-After header set"),
    )
)]
pub async fn csv(
    State(state): State<Arc<AppState>>,
    ValQuery(q): ValQuery<CsvParams>,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    // ADR-0014: max 90-day range. Larger windows must be paginated by the
    // client using a sliding `?from`. Cap intentionally tight — scraping a
    // full year of receipts is a Sub-project B concern, not v0.1.0.
    if (q.to - q.from).num_days() > 90 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "date_range_too_large",
                "max_days": 90,
                "hint": "use ?from older + paginate via subsequent calls"
            })),
        ));
    }
    if q.to <= q.from {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "invalid_date_range",
                "hint": "`to` must be strictly greater than `from`"
            })),
        ));
    }

    // ADR-0020: the CSV export is the bulk-download face of the discoverable
    // ledger index, so it is gated on FEATURE_PUBLIC_ALERTS alongside the
    // `/v1/audit` index and the RSS/Atom feeds. Date-range validation above
    // still applies (a 400 leaks nothing); but while the flag is false we
    // stream a header-only, well-formed CSV so scrapers can't enumerate the
    // calibration ledger before the 06-11 launch. Direct by-id lookups stay
    // ungated. We early-return here so the DB-backed stream below is skipped.
    if !state.feature_public_alerts {
        let empty = async_stream::stream! {
            // Yield nothing — an empty (zero-row) CSV body. The unreachable
            // `yield` only pins the stream's Item type to AuditCsvRow so
            // `StreamBodyAs::csv` type-infers the same way the live path does.
            if false {
                yield AuditCsvRow {
                    alert_id: String::new(),
                    asset: String::new(),
                    class: String::new(),
                    from_state: String::new(),
                    to_state: String::new(),
                    discount: String::new(),
                    intrinsic_usd: String::new(),
                    market_usd: String::new(),
                    confidence: String::new(),
                    detected_at: String::new(),
                    methodology_version: String::new(),
                    assets_toml_sha256: String::new(),
                    receipt_sha256: String::new(),
                    onchain_tx_sig: None,
                };
            }
        };
        let filename = format!(
            "pegana-audits-{}-{}.csv",
            q.from.format("%Y%m%d"),
            q.to.format("%Y%m%d")
        );
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            "text/csv; charset=utf-8".parse().unwrap(),
        );
        headers.insert(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\"")
                .parse()
                .unwrap(),
        );
        headers.insert(header::CACHE_CONTROL, "no-cache".parse().unwrap());
        // With has_headers = true this now genuinely is the "header-only,
        // well-formed CSV" the comment above always claimed; previously a
        // zero-row stream produced a zero-BYTE body.
        return Ok((
            headers,
            StreamBodyAs::with_options(
                CsvStreamFormat::new(true, b','),
                empty.map(Ok::<AuditCsvRow, axum::Error>),
                StreamBodyAsOptions::new(),
            ),
        )
            .into_response());
    }

    let pg = state.pg.clone();
    let asset = q.asset.clone();
    let from = q.from;
    let to = q.to;

    // Beta cohort: monitoring_only assets are now INCLUDED in the public CSV
    // export — the egress gate was removed when they were released as beta.
    // (The JSON feeds carry a per-row `monitoring_only` flag; the CSV is a bulk
    // export, so consumers join on the asset to learn which rows are beta.)
    let stream = async_stream::stream! {
        // Composite cursor (ts, id) prevents row re-yields when two alerts
        // share the same microsecond `detected_at` (possible during depeg
        // bursts where multiple engines emit concurrently). First page uses
        // a sentinel high `id` so the strict-less-than on the second clause
        // is a no-op; subsequent pages use the LAST yielded row's (ts, id).
        let mut cursor_ts = to;
        let mut cursor_id: Option<Uuid> = None;
        let mut total_yielded: usize = 0;
        loop {
            let rows_result = match (asset.as_deref(), cursor_id) {
                (Some(a), Some(last_id)) => {
                    sqlx::query(
                        r#"SELECT a.id, a.asset, a.class::text AS class,
                                  a.from_state::text AS from_state, a.to_state::text AS to_state,
                                  a.discount::text AS discount,
                                  a.intrinsic_usd::text AS intrinsic_usd,
                                  a.market_usd::text AS market_usd,
                                  a.confidence::text AS confidence, a.detected_at,
                                  e.methodology_version, e.assets_toml_sha256,
                                  e.receipt_sha256, e.onchain_tx_sig
                           FROM alerts a JOIN alert_evidence e ON e.alert_id = a.id
                           WHERE a.detected_at >= $2
                             AND a.asset = $3
                             AND (a.detected_at < $1 OR (a.detected_at = $1 AND a.id < $4))
                           ORDER BY a.detected_at DESC, a.id DESC LIMIT $5"#,
                    )
                    .bind(cursor_ts).bind(from).bind(a).bind(last_id).bind(CSV_PAGE)
                    .fetch_all(&pg).await
                }
                (Some(a), None) => {
                    sqlx::query(
                        r#"SELECT a.id, a.asset, a.class::text AS class,
                                  a.from_state::text AS from_state, a.to_state::text AS to_state,
                                  a.discount::text AS discount,
                                  a.intrinsic_usd::text AS intrinsic_usd,
                                  a.market_usd::text AS market_usd,
                                  a.confidence::text AS confidence, a.detected_at,
                                  e.methodology_version, e.assets_toml_sha256,
                                  e.receipt_sha256, e.onchain_tx_sig
                           FROM alerts a JOIN alert_evidence e ON e.alert_id = a.id
                           WHERE a.detected_at <= $1 AND a.detected_at >= $2 AND a.asset = $3
                           ORDER BY a.detected_at DESC, a.id DESC LIMIT $4"#,
                    )
                    .bind(cursor_ts).bind(from).bind(a).bind(CSV_PAGE)
                    .fetch_all(&pg).await
                }
                (None, Some(last_id)) => {
                    sqlx::query(
                        r#"SELECT a.id, a.asset, a.class::text AS class,
                                  a.from_state::text AS from_state, a.to_state::text AS to_state,
                                  a.discount::text AS discount,
                                  a.intrinsic_usd::text AS intrinsic_usd,
                                  a.market_usd::text AS market_usd,
                                  a.confidence::text AS confidence, a.detected_at,
                                  e.methodology_version, e.assets_toml_sha256,
                                  e.receipt_sha256, e.onchain_tx_sig
                           FROM alerts a JOIN alert_evidence e ON e.alert_id = a.id
                           WHERE a.detected_at >= $2
                             AND (a.detected_at < $1 OR (a.detected_at = $1 AND a.id < $3))
                           ORDER BY a.detected_at DESC, a.id DESC LIMIT $4"#,
                    )
                    .bind(cursor_ts).bind(from).bind(last_id).bind(CSV_PAGE)
                    .fetch_all(&pg).await
                }
                (None, None) => {
                    sqlx::query(
                        r#"SELECT a.id, a.asset, a.class::text AS class,
                                  a.from_state::text AS from_state, a.to_state::text AS to_state,
                                  a.discount::text AS discount,
                                  a.intrinsic_usd::text AS intrinsic_usd,
                                  a.market_usd::text AS market_usd,
                                  a.confidence::text AS confidence, a.detected_at,
                                  e.methodology_version, e.assets_toml_sha256,
                                  e.receipt_sha256, e.onchain_tx_sig
                           FROM alerts a JOIN alert_evidence e ON e.alert_id = a.id
                           WHERE a.detected_at <= $1 AND a.detected_at >= $2
                           ORDER BY a.detected_at DESC, a.id DESC LIMIT $3"#,
                    )
                    .bind(cursor_ts).bind(from).bind(CSV_PAGE)
                    .fetch_all(&pg).await
                }
            };
            let rows = match rows_result {
                Ok(r) => r,
                Err(e) => {
                    // #R4-1: a mid-export DB failure truncates a compliance CSV
                    // that still looks complete — the streaming body already
                    // committed 200 + headers, so the status can't change and a
                    // trailer can't be added. Make it OBSERVABLE (metric +
                    // Sentry) so a silently-short export is caught; inline client
                    // signalling would need a buffered/Result-stream refactor.
                    tracing::error!(?e, rows = total_yielded, "audit csv query failed mid-stream");
                    metrics::counter!("pegana_audit_csv_truncated_total", "reason" => "query_error")
                        .increment(1);
                    sentry::capture_message(
                        &format!(
                            "audit CSV export truncated mid-stream after {total_yielded} rows: {e}"
                        ),
                        sentry::Level::Error,
                    );
                    break;
                }
            };
            let count = rows.len();
            let mut last_seen: Option<(DateTime<Utc>, Uuid)> = None;
            for row in &rows {
                let ts = row.get::<DateTime<Utc>, _>("detected_at");
                let id = row.get::<Uuid, _>("id");
                // Advance the cursor for every row scanned so the composite
                // (ts, id) cursor always progresses across pages.
                last_seen = Some((ts, id));
                let asset_sym = row.get::<String, _>("asset");
                let csv_row = AuditCsvRow {
                    alert_id: id.to_string(),
                    asset: asset_sym,
                    class: row.get::<String, _>("class"),
                    from_state: row.get::<String, _>("from_state"),
                    to_state: row.get::<String, _>("to_state"),
                    discount: row.get::<String, _>("discount"),
                    intrinsic_usd: row.get::<String, _>("intrinsic_usd"),
                    market_usd: row.get::<String, _>("market_usd"),
                    confidence: row.get::<String, _>("confidence"),
                    detected_at: crate::serde_fmt::rfc3339_millis_z(&ts),
                    methodology_version: row.get::<String, _>("methodology_version"),
                    assets_toml_sha256: row.get::<String, _>("assets_toml_sha256"),
                    receipt_sha256: row.get::<String, _>("receipt_sha256"),
                    onchain_tx_sig: row.try_get::<Option<String>, _>("onchain_tx_sig").ok().flatten(),
                };
                total_yielded += 1;
                yield csv_row;
                if total_yielded >= CSV_MAX_ROWS {
                    tracing::info!(
                        rows = total_yielded,
                        "audit csv hit ADR-0014 50k cap; terminating stream"
                    );
                    metrics::counter!("pegana_audit_csv_truncated_total", "reason" => "row_cap")
                        .increment(1);
                    return;
                }
            }
            if count < CSV_PAGE as usize {
                break;
            }
            match last_seen {
                Some((ts, id)) => {
                    cursor_ts = ts;
                    cursor_id = Some(id);
                }
                None => break,
            }
            if cursor_ts < from {
                break;
            }
        }
    };

    let filename = format!(
        "pegana-audits-{}-{}.csv",
        q.from.format("%Y%m%d"),
        q.to.format("%Y%m%d")
    );
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "text/csv; charset=utf-8".parse().unwrap(),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{filename}\"")
            .parse()
            .unwrap(),
    );
    headers.insert(header::CACHE_CONTROL, "no-cache".parse().unwrap());

    Ok((
        headers,
        StreamBodyAs::with_options(
            CsvStreamFormat::new(true, b','),
            stream.map(Ok::<AuditCsvRow, axum::Error>),
            StreamBodyAsOptions::new(),
        ),
    )
        .into_response())
}
