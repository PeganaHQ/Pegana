//! Shared JSON error envelope for the public `/v1` API (P4).
//!
//! Every error body is `{"error": <code>, "message": <human>, "asset"?: <symbol>}`
//! with a matching HTTP status, replacing the bare `(StatusCode, String)`
//! text/plain tuples the assets routes used. The rest of the API is JSON, so a
//! client that `.json()`s every response no longer breaks on errors. The codes
//! also split "unknown asset" from "tracked asset, no data yet", which the old
//! shared "no snapshots for X" message conflated.
//!
//! Codes: `unknown_asset` (404) · `no_data` (404) · `invalid_bucket` (400) ·
//! `invalid_query` (400) · `bad_request` (400) · `internal` (500). Every error
//! across the public API is JSON.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct ApiError {
    /// Stable, machine-readable code. Branch on this, never on `message`.
    pub error: String,
    /// Human-readable explanation. NOT stable — for humans/logs; do not parse.
    pub message: String,
    /// The offending asset symbol, present only for asset-scoped errors.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset: Option<String>,
}

impl ApiError {
    /// 404 — the symbol is not in the tracked universe at all.
    pub fn unknown_asset(symbol: impl Into<String>) -> Self {
        let symbol = symbol.into();
        Self {
            message: format!("asset '{symbol}' is not in the tracked universe"),
            error: "unknown_asset".into(),
            asset: Some(symbol),
        }
    }

    /// 404 — the symbol IS tracked but has no snapshot yet (distinct from unknown).
    pub fn no_data(symbol: impl Into<String>) -> Self {
        let symbol = symbol.into();
        Self {
            message: format!("asset '{symbol}' is tracked but has no snapshot yet"),
            error: "no_data".into(),
            asset: Some(symbol),
        }
    }

    /// 400 — an unsupported `?bucket=` value.
    pub fn invalid_bucket(got: &str, valid: &[&str]) -> Self {
        Self {
            error: "invalid_bucket".into(),
            message: format!(
                "invalid bucket '{got}' — valid values: {}",
                valid.join(", ")
            ),
            asset: None,
        }
    }

    /// 400 — the query string could not be deserialized: a missing required
    /// param or an unparseable value. Replaces axum's default `text/plain`
    /// `QueryRejection` so every error on the public surface stays JSON
    /// (Gecko API report 2026-06-10). Raised by `crate::extract::ValQuery`.
    pub fn invalid_query(message: impl Into<String>) -> Self {
        Self {
            error: "invalid_query".into(),
            message: message.into(),
            asset: None,
        }
    }

    /// 400 — a generic bad request with a specific human reason (validation
    /// failure on a query parameter, e.g. an unsupported `shock_bps`).
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self {
            error: "bad_request".into(),
            message: message.into(),
            asset: None,
        }
    }

    /// 500 — an internal failure from any non-sqlx source. Logs the cause; the
    /// body stays opaque. (`db` is the sqlx-specific shortcut with the same shape.)
    pub fn internal<E: std::fmt::Debug>(e: E) -> Self {
        tracing::error!(?e, "internal error");
        Self {
            error: "internal".into(),
            message: "internal error".into(),
            asset: None,
        }
    }

    /// 500 — an internal/database failure. Logs the cause; the body stays opaque.
    pub fn db(e: sqlx::Error) -> Self {
        tracing::error!(?e, "db error");
        Self {
            error: "internal".into(),
            message: "internal error".into(),
            asset: None,
        }
    }

    /// HTTP status derived from the code — single source of truth, kept out of
    /// the serialized body.
    fn status(&self) -> StatusCode {
        match self.error.as_str() {
            "invalid_bucket" | "invalid_limit" | "invalid_query" | "bad_request" => {
                StatusCode::BAD_REQUEST
            }
            "unauthorized" => StatusCode::UNAUTHORIZED,
            "internal" => StatusCode::INTERNAL_SERVER_ERROR,
            // unknown_asset | no_data | not_found
            _ => StatusCode::NOT_FOUND,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status(), Json(self)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_shape_codes_and_status() {
        let e = ApiError::unknown_asset("FOO");
        assert_eq!(e.status(), StatusCode::NOT_FOUND);
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(
            v.get("error").and_then(|x| x.as_str()),
            Some("unknown_asset")
        );
        assert_eq!(v.get("asset").and_then(|x| x.as_str()), Some("FOO"));
        assert!(v.get("message").and_then(|x| x.as_str()).is_some());
        // The status must never leak into the JSON body.
        assert!(v.get("status").is_none());

        let nd = ApiError::no_data("BAR");
        assert_eq!(nd.status(), StatusCode::NOT_FOUND);
        let ndv = serde_json::to_value(&nd).unwrap();
        assert_eq!(ndv.get("error").and_then(|x| x.as_str()), Some("no_data"));
        assert_eq!(ndv.get("asset").and_then(|x| x.as_str()), Some("BAR"));

        let ib = ApiError::invalid_bucket("5m", &["raw", "1m"]);
        assert_eq!(ib.status(), StatusCode::BAD_REQUEST);
        let ibv = serde_json::to_value(&ib).unwrap();
        assert_eq!(
            ibv.get("error").and_then(|x| x.as_str()),
            Some("invalid_bucket")
        );
        // Not asset-scoped → asset omitted (not null).
        assert!(ibv.get("asset").is_none());
        assert!(ibv
            .get("message")
            .and_then(|x| x.as_str())
            .unwrap()
            .contains("raw"));
    }
}
