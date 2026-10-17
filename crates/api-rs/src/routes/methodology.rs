//! /v1/methodology/current — public lifecycle status of the active methodology.
//!
//! Consumed by:
//!   * web/app/api/methodology/route.ts (home page trust strip)
//!   * future agent integrations that want to know "is the methodology
//!     I'm reading receipts under still considered correct?"
//!
//! Returns the LATEST released methodology version (by released_at DESC)
//! with its current status. If the latest is `broken`, includes a fix_url
//! pointing operators to the broken-version banner on /methodology.
//!
//! Wave 10+11 review fix: the web /api/methodology route was always
//! falling back to a hardcoded "active" constant because this endpoint
//! didn't exist — masking real broken-state lifecycle changes.

use crate::AppState;
use axum::{extract::State, http::header, response::IntoResponse, Json};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;
use std::sync::Arc;
use utoipa::ToSchema;

/// Public methodology lifecycle pointer.
///
/// `version`, `status`, and `fix_url` are the original (v1) shape — every
/// current consumer (web/app/api/methodology/route.ts type-checks only
/// `version`+`status`) is forward-compatible with the additive fields below.
#[derive(Debug, Serialize, ToSchema)]
pub struct MethodologyCurrentResponse {
    /// Semver version of the currently-active methodology crate.
    pub version: String,
    /// Lifecycle status from `methodology_versions.status` enum:
    /// `active | deprecated | broken`.
    pub status: String,
    /// Only populated when status = `broken`. Points at the `#lifecycle`
    /// section of /methodology, which renders the broken-version banner.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix_url: Option<String>,
    /// Immutable git release tag, e.g. `methodology-v0.1.0`. Always present
    /// when the version table is populated; omitted only on an un-migrated DB.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_tag: Option<String>,
    /// RFC3339 timestamp this version was released. The honest analogue of the
    /// often-requested "adopted_at" — there is no separate adoption column;
    /// release == adoption in this lifecycle (ADR-0003).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub released_at: Option<String>,
    /// Operator note attached to a `deprecated`/`broken` transition, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_reason: Option<String>,
    /// Set when this version has been superseded by a newer one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub superseded_by: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v1/methodology/current",
    tag = "methodology",
    summary = "Get the active methodology version",
    responses(
        (status = 200, description = "Current methodology version + lifecycle status", body = MethodologyCurrentResponse),
        (status = 500, description = "Database error"),
    )
)]
pub async fn current(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (axum::http::StatusCode, Json<serde_json::Value>)> {
    // Pick the newest released version. We sort by released_at DESC so a
    // version published OUT OF ORDER (e.g. 0.1.3 patches before 0.1.2 lands)
    // still surfaces the actually-most-recent one. The semver ordering is a
    // weaker signal because operators may release out of strict semver
    // (e.g. branch hotfix).
    type Row = (
        String,         // version
        String,         // git_tag      (NOT NULL)
        DateTime<Utc>,  // released_at  (NOT NULL)
        String,         // status
        Option<String>, // status_reason
        Option<String>, // superseded_by
    );
    let row: Option<Row> = sqlx::query_as(
        "SELECT version, git_tag, released_at, status, status_reason, superseded_by \
         FROM methodology_versions \
         ORDER BY released_at DESC \
         LIMIT 1",
    )
    .fetch_optional(&state.pg)
    .await
    .map_err(|e| {
        tracing::error!(?e, "methodology current query failed");
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "internal"})),
        )
    })?;

    // B-006 follow-up: anchor the operator at the live `#lifecycle` section of
    // /methodology (which renders the broken-version banner), NOT a synthetic
    // `#{version}-broken` id that the page never defined — that link silently
    // fell back to the page top. Aligns with web/app/api/methodology/route.ts,
    // which already uses `#lifecycle` as its broken-status fallback.
    let fix_url = |status: &str| {
        if status == "broken" {
            Some("https://pegana.xyz/methodology#lifecycle".to_string())
        } else {
            None
        }
    };

    let body = match row {
        Some((version, git_tag, released_at, status, status_reason, superseded_by)) => {
            let fix_url = fix_url(&status);
            MethodologyCurrentResponse {
                version,
                status,
                fix_url,
                git_tag: Some(git_tag),
                released_at: Some(crate::serde_fmt::rfc3339_millis_z(&released_at)),
                status_reason,
                superseded_by,
            }
        }
        None => {
            // Migration 0030 seeds v0.1.0 active; only an empty/un-migrated DB
            // hits this branch. Emit the same minimal fallback the web layer
            // already uses — the enriched fields are honestly omitted (no row
            // means we cannot synthesize a real released_at/git_tag).
            MethodologyCurrentResponse {
                version: "0.1.0".to_string(),
                status: "active".to_string(),
                fix_url: None,
                git_tag: None,
                released_at: None,
                status_reason: None,
                superseded_by: None,
            }
        }
    };

    // Short cache — operators flipping `status` should propagate within a
    // minute. Web's /api/methodology already has its own 60s revalidate;
    // this header lets Caddy or a CDN tier add a cushion.
    let headers = [(header::CACHE_CONTROL, "public, max-age=60")];
    Ok((headers, Json(body)))
}
