//! JSON-envelope query extractor — `ValQuery<T>` — that rejects with the API's
//! JSON error envelope instead of axum's default `text/plain` body.
//!
//! axum's stock `Query<T>` returns a bare `text/plain` body on a
//! missing/unparseable param (e.g. `/v1/audit.csv` without `from`). That
//! breaks any client that `.json()`s every response and is at odds with
//! `error.rs`'s promise that the whole API speaks JSON (Gecko API report
//! 2026-06-10 + deep-audit follow-up). This wrapper delegates to axum's exact
//! deserialization, then maps the rejection to a JSON body —
//! `ApiError {error:"invalid_query"}`. OpenAPI params are declared in
//! `#[utoipa::path]`, independent of the extractor, so swapping the extractor
//! leaves the spec unchanged.

use crate::error::ApiError;
use axum::async_trait;
use axum::extract::{FromRequestParts, Query};
use axum::http::request::Parts;
use serde::de::DeserializeOwned;

/// Drop-in replacement for `axum::extract::Query` whose rejection is a JSON
/// `ApiError` (HTTP 400, `error: "invalid_query"`).
pub struct ValQuery<T>(pub T);

#[async_trait]
impl<T, S> FromRequestParts<S> for ValQuery<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        match Query::<T>::try_from_uri(&parts.uri) {
            Ok(Query(value)) => Ok(ValQuery(value)),
            // body_text() preserves axum's helpful detail (e.g. names the
            // missing field) — we only change the envelope to JSON.
            Err(rejection) => Err(ApiError::invalid_query(rejection.body_text())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Demo {
        // Required: a missing value is the `/v1/audit.csv` "dead end" case.
        from: String,
    }

    async fn extract(uri: &str) -> Result<ValQuery<Demo>, ApiError> {
        let (mut parts, _) = Request::builder().uri(uri).body(()).unwrap().into_parts();
        ValQuery::<Demo>::from_request_parts(&mut parts, &()).await
    }

    #[tokio::test]
    async fn missing_required_param_rejects_as_json_api_error() {
        let err = extract("/v1/audit.csv").await.err().expect("should reject");
        // The whole point: a JSON-shaped, 400 invalid_query — never text/plain.
        assert_eq!(err.error, "invalid_query");
        assert!(
            err.message.contains("from"),
            "message should name the missing field, got: {}",
            err.message
        );
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v["error"], "invalid_query");
        assert!(v.get("message").is_some());
    }

    #[tokio::test]
    async fn valid_query_parses() {
        let ok = extract("/v1/audit.csv?from=2026-06-01").await;
        assert!(ok.is_ok(), "valid query should parse");
        assert_eq!(ok.ok().unwrap().0.from, "2026-06-01");
    }
}
