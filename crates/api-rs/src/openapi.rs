//! OpenAPI 3.1 spec assembled from `#[utoipa::path]` annotations on every
//! handler + `#[derive(utoipa::ToSchema)]` on every response struct.
//!
//! Served at `GET /openapi.json` — the single source of truth for the API
//! surface. Mintlify's API Reference tab consumes this URL directly
//! (`docs-site/docs.json` points at it); the old hand-written
//! `docs-site/api-reference/openapi.yaml` has been removed.
//!
//! ## Coverage
//!
//! Every router handler is annotated and listed in `ApiDoc::paths(...)` below —
//! the anonymous public read routes plus the `/v1/ws` upgrade stub.
//! `/openapi.json` itself is conventionally self-excluded. The
//! `openapi_covers_public_paths` test pins the count so a new route added to
//! the router without an annotation fails CI.
//!
//! Every route is public and unauthenticated, so no security scheme is
//! registered.
//!
//! To add a new route:
//! 1. Add `#[derive(utoipa::ToSchema)]` to its request/response structs.
//! 2. Decorate the handler with `#[utoipa::path(method, path = "...", ...)]`.
//!    Path params use `{name}` syntax (axum's `:name` → utoipa `{name}`).
//! 3. Append the handler to `ApiDoc::paths(...)` and any new struct to
//!    `components(schemas(...))` below, then bump the count in the coverage test.
//!
//! See `routes/health.rs` or `routes/assets.rs` for a working pattern.

use axum::Json;
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Pegana API",
        version = "1.0.0",
        description = "The peg-risk oracle for Solana. Read real-time peg state, \
                       history, and delivery health across the live \
                       mainnet asset universe spanning 6 classes — LSTs, fiat / CDP / \
                       delta-neutral / yield-bearing / FX stables, and a \
                       leveraged synthetic. Some assets are flagged \
                       `monitoring_only` (beta): their alerts are live but the \
                       calibration is provisional. Public read \
                       endpoints require no key and ARE rate-limited per IP \
                       (60/min global by default, 10/min on /v1/audit.csv; the \
                       live budget is the RateLimit-Limit header); exceeding the \
                       limit returns 429 with a Retry-After header. \
                       Every state transition emits a public receipt at \
                       /v1/audit/{id} with the methodology version and frozen \
                       inputs. Transitions into DEPEG, CRITICAL or BLACK_SWAN are \
                       also anchored on Solana with an SPL Memo commit when \
                       on-chain commits are enabled (ADR-0004); DRIFT and \
                       recovery transitions are never anchored, and some \
                       historical severe receipts carry no anchor. Check \
                       `onchain_tx_sig` or GET /v1/audit/{id}/onchain. EVERY \
                       error response across the API is JSON — the envelope is \
                       `{error, message, asset?}` (the `ApiError` schema); branch \
                       on the stable `error` code, never on `message`; some codes \
                       add extra keys (e.g. `got`, `hint`, `alert_id`). Any \
                       endpoint may also return 500 `{error:\"internal\"}` on an \
                       unexpected server error. Value conventions: monetary and \
                       ratio amounts are exact decimal STRINGS (parse with a decimal \
                       library, never a float) with trailing zeros trimmed; USD \
                       aggregate fields (e.g. `market_cap`, `loop_exposure_usd`, \
                       `liquidatable_usd`) are rounded to the cent while price/discount \
                       signal fields keep full precision. All timestamps are RFC3339 \
                       UTC with millisecond precision and a `Z` suffix \
                       (`2026-07-24T15:33:14.545Z`). Every response carries an \
                       `x-request-id` header (quote it when reporting an issue) and \
                       the rate-limit budget as `RateLimit-Limit` / `RateLimit-Remaining` \
                       / `RateLimit-Reset` (mirrored as `X-RateLimit-*`); a 429 also \
                       sets `Retry-After`.",
        license(name = "MIT", identifier = "MIT"),
        contact(name = "Rafael Souza", email = "rafael@pegana.xyz")
    ),
    servers(
        (url = "https://api.pegana.xyz", description = "Production")
    ),
    paths(
        crate::routes::health::root,
        crate::routes::health::live,
        crate::routes::health::ready,
        crate::routes::health::webhook_ips,
        crate::routes::health::webhook_keys,
        crate::routes::assets::list,
        crate::routes::assets::detail,
        crate::routes::assets::history,
        crate::routes::assets::state,
        crate::routes::assets::detail_by_mint,
        crate::routes::assets::state_by_mint,
        // Sub-C Loop Intelligence — advisory leverage exposure + cascade sim (ADR-0036).
        crate::routes::assets::loop_exposure,
        crate::routes::assets::simulate_depeg,
        crate::routes::stats::summary,
        crate::routes::calibration::summary,
        // Trust Layer Phase 4 — /v1/audit/* public receipt surface.
        crate::routes::audit::detail,
        crate::routes::audit::replay_bundle,
        crate::routes::audit::onchain,
        crate::routes::audit::index,
        crate::routes::audit::csv,
        // Wave 13C audit D P2 — surface /v1/methodology/current in OpenAPI
        // so the Mintlify API reference + the SDK code-gen pipeline pick
        // up the lifecycle endpoint. Used by web/api/methodology to power
        // the home-page trust strip.
        crate::routes::methodology::current,
        // tokens.xyz signal-out feed (mint-keyed peg signal).
        crate::routes::peg::feed,
        crate::routes::peg::feed_by_mint,
        // Live stream (documented upgrade stub; returns 101).
        crate::ws::ws_handler,
    ),
    components(
        schemas(
            crate::routes::health::LiveResponse,
            crate::routes::health::ReadyResponse,
            crate::routes::health::SourceFreshness,
            crate::routes::health::WebhookIpsResponse,
            crate::routes::health::WebhookKeysResponse,
            crate::routes::assets::AssetCard,
            crate::routes::assets::HistoryPoint,
            crate::routes::assets::StateResp,
            crate::routes::assets::LoopExposureResponse,
            crate::routes::assets::LoopByProtocol,
            crate::routes::assets::SimulateDepegResponse,
            crate::routes::assets::SimulateByProtocol,
            crate::routes::assets::CascadeRung,
            crate::routes::assets::SystemicSignal,
            // Advisory, out-of-hash amber annotation on the single-asset
            // detail endpoints only (see oracle_degraded.rs).
            crate::oracle_degraded::OracleDegraded,
            crate::market_score::MarketDepth,
            crate::market_score::MarketDepthComponents,
            crate::error::ApiError,
            crate::routes::stats::StatsResponse,
            crate::routes::stats::DeliveryHealth,
            crate::routes::audit::AuditDetailResponse,
            crate::routes::audit::AuditAlert,
            crate::routes::audit::AuditEvidence,
            crate::routes::audit::AuditPendingResponse,
            crate::routes::audit::AuditGoneResponse,
            crate::routes::audit::OnchainResponse,
            crate::routes::audit::AuditIndexRow,
            crate::routes::audit::AuditCsvRow,
            crate::routes::methodology::MethodologyCurrentResponse,
            crate::routes::peg::PegSignal,
            crate::routes::peg::PegFeedResponse,
            // Doc-only enums referenced via `#[schema(value_type = ...)]` on the
            // string state/confidence/anchor fields so clients can model the
            // closed value sets (Gecko API report 2026-06-10).
            crate::schema::PegState,
            crate::schema::Confidence,
            crate::schema::Calibration,
            // C1/C2 (2026-06-18): anchor tells consumers how to interpret the
            // asset's fair value — "USD" ($1 target), "FX" (non-USD fiat peg,
            // read `peg_target` for currency), or "NAV" (intrinsic value, not
            // a fixed rate).  Derived from `class`; referenced via
            // `#[schema(value_type = ...)]` on `AssetCard.anchor`.
            crate::schema::Anchor,
        )
    ),
    tags(
        (name = "Health", description = "Liveness and readiness probes"),
        (name = "Assets", description = "Public read access to asset state, history, and metadata"),
        (name = "Stats", description = "Aggregate counters and delivery health"),
        (name = "WebSocket", description = "Live state stream"),
        (name = "audit", description = "Public receipts for alerts — methodology version, inputs frozen, replay bundles. All endpoints public, no auth, cacheable. ADR-0006 four-state response on /v1/audit/:id (200/202/404/410); ADR-0014 bounds (90-day max, 100-row max, 50k-row cap)."),
        (name = "methodology", description = "Public lifecycle status of the active methodology — version + status (active/deprecated/broken) + optional fix_url when broken. Consumed by web/app/api/methodology to power the home-page trust strip."),
        (name = "peg", description = "Peg-signal feed for tokens.xyz / aggregator consumption — a `data` array of per-asset signals (each carries its own `mint`). Public, no auth, cacheable. Honest beta status via `calibration` + `monitoring_only`; freshness via `updated_at` + `stale`."),
    )
)]
pub struct ApiDoc;

/// Handler for `GET /openapi.json`. Serves the spec assembled from utoipa
/// annotations. Cached client-side via standard ETag/Last-Modified (axum
/// defaults). Stable across requests since the spec is built once at
/// derive-time.
pub async fn openapi_json() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The info block is the first thing an integrator (and every generated
    /// SDK) reads. It once hardcoded "300/min" while production served 60, and
    /// claimed every transition carried an on-chain commit. Pin it to the
    /// config default and to the real anchor policy.
    #[test]
    fn info_description_matches_rate_limit_default_and_anchor_policy() {
        let doc = ApiDoc::openapi();
        let desc = doc.info.description.clone().unwrap_or_default();
        let expected = format!("{}/min global by default", crate::default_rate_limit());
        assert!(
            desc.contains(&expected),
            "info.description must state the default limit `{expected}`: {desc}"
        );
        assert!(!desc.contains("300/min"), "stale 300/min in: {desc}");
        assert!(
            desc.contains("DRIFT and recovery transitions are never anchored"),
            "info.description must not imply every receipt is anchored: {desc}"
        );
        assert!(
            !desc.contains("invalid_body"),
            "no route takes a request body, so invalid_body is never emitted: {desc}"
        );
    }

    /// (method, path, operation_id, summary) for every operation in the spec.
    /// Avoids naming utoipa's `Operation` type so the helper is robust across
    /// minor utoipa re-export shuffles.
    fn operation_meta(
        doc: &utoipa::openapi::OpenApi,
    ) -> Vec<(String, String, Option<String>, Option<String>)> {
        let mut out = Vec::new();
        for (path, item) in &doc.paths.paths {
            for (method, op) in [
                ("GET", &item.get),
                ("PUT", &item.put),
                ("POST", &item.post),
                ("DELETE", &item.delete),
                ("OPTIONS", &item.options),
                ("HEAD", &item.head),
                ("PATCH", &item.patch),
                ("TRACE", &item.trace),
            ] {
                if let Some(op) = op {
                    out.push((
                        method.to_string(),
                        path.clone(),
                        op.operation_id.clone(),
                        op.summary.clone(),
                    ));
                }
            }
        }
        out
    }

    /// Codegen guard (Gecko API report 2026-06-10): OpenAPI operationIds MUST
    /// be globally unique. utoipa derives operationId from the handler fn name
    /// by default, so two handlers both named `list` (assets + audit) or
    /// `detail` (assets + audit) silently collided — SDK generators
    /// (openapi-typescript-codegen, openapi-generator, Speakeasy, Fern) overwrite
    /// on duplicate operationId and drop one of each pair. Any new generically
    /// named handler fails here until it gets an explicit `operation_id = "..."`.
    #[test]
    fn operation_ids_are_unique() {
        let doc = ApiDoc::openapi();
        let mut seen: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        for (method, path, id, _) in operation_meta(&doc) {
            let id = id.unwrap_or_else(|| panic!("{method} {path} has no operationId"));
            if let Some(prev) = seen.insert(id.clone(), format!("{method} {path}")) {
                panic!(
                    "duplicate operationId `{id}`: [{method} {path}] collides with [{prev}] — \
                     give one an explicit operation_id = \"...\" in #[utoipa::path]"
                );
            }
        }
    }

    /// Docs-quality guard (Gecko API report 2026-06-10): every operation MUST
    /// carry a non-empty `summary`. Mintlify derives each API-reference page
    /// slug from the summary; an empty summary produced the broken
    /// `…/api-reference/health/get-.md` slug and a sparse reference. A new
    /// handler without a `summary = "..."` (or a doc-comment first line) fails
    /// here.
    #[test]
    fn every_operation_has_summary() {
        let doc = ApiDoc::openapi();
        let missing: Vec<String> = operation_meta(&doc)
            .into_iter()
            .filter(|(_, _, _, summary)| summary.as_deref().map(str::trim).unwrap_or("").is_empty())
            .map(|(method, path, _, _)| format!("{method} {path}"))
            .collect();
        assert!(
            missing.is_empty(),
            "{} operation(s) missing a summary: {missing:?}",
            missing.len()
        );
    }

    /// Every operation with a `{symbol}` or `{mint}` path parameter runs
    /// params.rs validation and can answer 400 `invalid_asset`, so the spec
    /// must list a 400 for it (round-2 finding: only 200/404 were listed).
    #[test]
    fn asset_path_operations_document_400() {
        let doc = ApiDoc::openapi();
        let mut checked = 0;
        for (path, item) in &doc.paths.paths {
            if !(path.contains("{symbol}") || path.contains("{mint}")) {
                continue;
            }
            let op = item.get.as_ref().expect("asset routes are GET");
            assert!(
                op.responses.responses.contains_key("400"),
                "GET {path} must document 400 invalid_asset"
            );
            checked += 1;
        }
        assert!(checked >= 8, "expected the asset routes, saw {checked}");
    }

    /// Enum guard (Gecko API report 2026-06-10): the class-aware `state` and
    /// the Pyth `confidence` bucket must be advertised as CLOSED enums, not
    /// opaque strings, so typed clients can model them. Asserts the doc-only
    /// `PegState` / `Confidence` components carry their full value set and that
    /// a representative field references `PegState` instead of a bare string.
    #[test]
    fn state_and_confidence_are_enums() {
        let doc = ApiDoc::openapi();
        let json = serde_json::to_value(&doc).unwrap();
        let schemas = &json["components"]["schemas"];

        let collect = |name: &str| -> Vec<String> {
            schemas[name]["enum"]
                .as_array()
                .unwrap_or_else(|| panic!("{name} should be an enum schema: {}", schemas[name]))
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect()
        };

        let peg = collect("PegState");
        for s in [
            "PEGGED",
            "DRIFT",
            "DEPEG",
            "CRITICAL",
            "BLACK_SWAN",
            "UNKNOWN",
        ] {
            assert!(
                peg.contains(&s.to_string()),
                "PegState missing `{s}`: {peg:?}"
            );
        }
        let conf = collect("Confidence");
        for s in ["high", "medium", "low", "unknown"] {
            assert!(
                conf.contains(&s.to_string()),
                "Confidence missing `{s}`: {conf:?}"
            );
        }
        let calib = collect("Calibration");
        for s in ["provisional", "calibrated"] {
            assert!(
                calib.contains(&s.to_string()),
                "Calibration missing `{s}`: {calib:?}"
            );
        }
        // Anchor enum is registered and carries exactly the three documented
        // values.  C2 (2026-06-18): stable_fx uses "FX" not "USD" so the
        // three-way model (USD / FX / NAV) is now the official contract.
        // AssetCard.anchor must reference it.
        let anchor = collect("Anchor");
        for s in ["USD", "FX", "NAV"] {
            assert!(
                anchor.contains(&s.to_string()),
                "Anchor missing `{s}`: {anchor:?}"
            );
        }
        assert_eq!(
            anchor.len(),
            3,
            "Anchor enum must have exactly 3 values (USD, FX, NAV), got {anchor:?}"
        );
        let anchor_field = serde_json::to_string(&schemas["AssetCard"]["properties"]["anchor"])
            .expect("serialize anchor field");
        assert!(
            anchor_field.contains("Anchor"),
            "AssetCard.anchor must reference Anchor schema, got {anchor_field}"
        );

        // A bare-string field would have no $ref; assert StateResp.state points
        // at the PegState component.
        let state_field = serde_json::to_string(&schemas["StateResp"]["properties"]["state"])
            .expect("serialize state field");
        assert!(
            state_field.contains("PegState"),
            "StateResp.state must reference PegState, got {state_field}"
        );
    }

    /// Lockstep guard (deep-audit 2026-06-10): the audit-detail receipt schema
    /// must mirror the runtime `json!` body — real typed sub-objects, not the
    /// old opaque `{alert:{}, evidence:{}}`. If the handler body and these
    /// structs drift, this is the early warning.
    #[test]
    fn audit_detail_response_is_typed() {
        let doc = ApiDoc::openapi();
        let json = serde_json::to_value(&doc).unwrap();
        let schemas = &json["components"]["schemas"];

        let props = &schemas["AuditDetailResponse"]["properties"];
        for k in ["alert", "evidence", "evidence_status"] {
            assert!(props.get(k).is_some(), "AuditDetailResponse missing `{k}`");
        }
        let alert = &schemas["AuditAlert"]["properties"];
        for k in [
            "id",
            "asset",
            "class",
            "from_state",
            "to_state",
            "discount",
            "intrinsic_usd",
            "market_usd",
            "confidence",
            "detected_at",
        ] {
            assert!(alert.get(k).is_some(), "AuditAlert missing `{k}`");
        }
        let ev = &schemas["AuditEvidence"]["properties"];
        for k in [
            "methodology_version",
            "assets_toml_sha256",
            "inputs_frozen",
            "computed",
            "has_replay_artifact",
            "receipt_sha256",
            "created_at",
        ] {
            assert!(ev.get(k).is_some(), "AuditEvidence missing `{k}`");
        }
    }

    /// Envelope contract guard (F1 of the `/v1` reshape): every list endpoint's
    /// 200 body is the uniform `ApiList` envelope — a top-level OBJECT with
    /// `ok` / `generated_at` / `count` and a `data` ARRAY — not a bare array.
    /// utoipa 5 registers each generic instantiation as a named component
    /// (`ApiList_AssetCard`, …) and `$ref`s it; resolving the ref proves the
    /// component exists (no dangling `$ref`) and carries the envelope shape.
    #[test]
    fn list_endpoints_expose_uniform_envelope() {
        let doc = ApiDoc::openapi();
        let json = serde_json::to_value(&doc).unwrap();
        let schemas = &json["components"]["schemas"];

        // Resolve a `{ "$ref": "#/components/schemas/X" }` to the component `X`;
        // pass inline schemas through unchanged.
        let resolve = |schema: &serde_json::Value| -> serde_json::Value {
            match schema.get("$ref").and_then(|r| r.as_str()) {
                Some(r) => {
                    let name = r.rsplit('/').next().unwrap_or_default();
                    let target = &schemas[name];
                    assert!(
                        !target.is_null(),
                        "dangling $ref `{r}` — component `{name}` not in the spec"
                    );
                    target.clone()
                }
                None => schema.clone(),
            }
        };

        for path in [
            "/v1/assets",
            "/v1/calibration",
            "/v1/assets/{symbol}/history",
            // The mint-keyed feed is now an array under the same envelope shape
            // (it carries an extra top-level `methodology` stamp).
            "/v1/peg/feed",
        ] {
            let body = &json["paths"][path]["get"]["responses"]["200"]["content"]
                ["application/json"]["schema"];
            assert!(
                !body.is_null(),
                "{path} 200 must document a JSON schema, got null"
            );
            let schema = resolve(body);
            let props = &schema["properties"];
            for key in ["ok", "generated_at", "count", "data"] {
                assert!(
                    props.get(key).is_some(),
                    "{path} 200 envelope missing `{key}` — schema was {schema}"
                );
            }
            assert_eq!(
                props["data"]["type"].as_str(),
                Some("array"),
                "{path} 200 `data` must be an array — schema was {schema}"
            );
        }
    }

    // Coverage guard: the public routes must stay in the spec, and the count is
    // pinned so a future router route added without a #[utoipa::path]
    // annotation fails here instead of silently shipping an incomplete spec.
    #[test]
    fn openapi_covers_public_paths() {
        let doc = ApiDoc::openapi();
        let paths = &doc.paths.paths;
        for p in [
            "/",
            "/healthz",
            "/readyz",
            "/v1/meta/webhook-ips",
            "/v1/meta/webhook-keys",
            "/v1/ws",
            "/v1/methodology/current",
            "/v1/assets",
            "/v1/assets/by-mint/{mint}",
            "/v1/assets/by-mint/{mint}/state",
            "/v1/calibration",
            "/v1/stats",
            "/v1/peg/feed",
            "/v1/audit",
        ] {
            assert!(paths.contains_key(p), "OpenAPI missing path {p}");
        }
        // /openapi.json describes the surface; it is not itself in it.
        assert!(!paths.contains_key("/openapi.json"));
        // The removed account surface must never come back silently.
        for gone in ["/v1/me", "/v1/auth/telegram", "/v1/alerts"] {
            assert!(!paths.contains_key(gone), "{gone} should not be documented");
        }
        // Unique path-item count (handlers on the same path collapse into one
        // item with multiple operations). Bump this deliberately when adding
        // routes — a drop means a missing annotation.
        assert_eq!(
            paths.len(),
            24,
            "unique OpenAPI path count changed — a route may be missing its #[utoipa::path]"
        );
    }
}
