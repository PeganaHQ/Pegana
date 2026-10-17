> ⚠️ **AMENDED** — see [`AMENDMENTS.md`](AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original spec preserved below as historical reference.

---

# 07 — API Surface

> 5 new REST endpoints under `/v1/audit*` in `crates/api-rs`. All public, no auth, immutable-cacheable. Plus `tower_http::cors` layer scoped to `/v1/assets/*` for embed widget.

---

## 1. New routes summary

| Method + Path | Handler | Response | Cache headers |
|---|---|---|---|
| `GET /v1/audit/:alert_id` | `routes::audit::detail` | 200 receipt JSON / 404 not_found / 404 evidence_missing | `Cache-Control: public, max-age=31536000, immutable` |
| `GET /v1/audit/:alert_id/replay-bundle` | `routes::audit::replay_bundle` | 200 bundle JSON (with `Content-Disposition: attachment`) / 404 no_replay_artifact | `Cache-Control: public, max-age=31536000, immutable` |
| `GET /v1/audit/:alert_id/onchain` | `routes::audit::onchain` | 200 `{tx_sig, explorer_url}` / 404 not_committed_yet | `Cache-Control: public, max-age=60` (sig may be pending) |
| `GET /v1/audit?limit&exclude_pegged` | `routes::audit::index` | 200 array of recent audits | `Cache-Control: public, max-age=60` |
| `GET /v1/audit.csv?from&to&asset` | `routes::audit::csv` | 200 streaming CSV (chunked transfer encoding) | `Cache-Control: no-cache` (range may change) |

All under tag `audit` in OpenAPI spec.

---

## 2. Module structure

```
crates/api-rs/src/
├── main.rs               # register routes (5 new lines)
├── openapi.rs            # register handlers in #[derive(OpenApi)] paths
└── routes/
    ├── mod.rs            # pub mod audit;
    └── audit.rs          # NEW — all 5 handlers
```

If `routes/` directory doesn't exist today, create with `mod.rs` declaring `audit` submodule.

---

## 3. `GET /v1/audit/:alert_id` — receipt detail

```rust
#[utoipa::path(
    get,
    path = "/v1/audit/{alert_id}",
    params(("alert_id" = String, Path, description = "Alert UUID")),
    responses(
        (status = 200, description = "Receipt JSON"),
        (status = 400, description = "Invalid UUID format"),
        (status = 404, description = "Alert not found OR evidence missing (distinguished by error field)"),
    ),
    tag = "audit"
)]
pub async fn detail(
    State(state): State<Arc<AppState>>,
    Path(alert_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let id = Uuid::parse_str(&alert_id).map_err(|_| {
        (StatusCode::BAD_REQUEST, Json(json!({"error": "invalid_uuid"})))
    })?;

    let row = sqlx::query(/* JOIN alerts + alert_evidence */)
        .bind(id).fetch_optional(&state.pg).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "db_error", "message": e.to_string()}))))?;

    let row = row.ok_or_else(|| {
        (StatusCode::NOT_FOUND, Json(json!({"error": "alert_not_found", "alert_id": alert_id})))
    })?;

    let methodology_version: Option<String> = row.try_get("methodology_version").ok();
    if methodology_version.is_none() {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "evidence_missing", "alert_id": alert_id}))));
    }

    let body = json!({
        "alert": {
            "id": row.get::<Uuid, _>("id").to_string(),
            "asset": row.get::<String, _>("asset"),
            "class": row.get::<String, _>("class"),
            "from_state": row.get::<String, _>("from_state"),
            "to_state": row.get::<String, _>("to_state"),
            "discount": row.get::<sqlx::types::Decimal, _>("discount").to_string(),
            "intrinsic_usd": row.get::<sqlx::types::Decimal, _>("intrinsic_usd").to_string(),
            "market_usd": row.get::<sqlx::types::Decimal, _>("market_usd").to_string(),
            "confidence": row.get::<String, _>("confidence"),
            "detected_at": row.get::<chrono::DateTime<chrono::Utc>, _>("detected_at"),
        },
        "evidence": {
            "methodology_version": methodology_version,
            "methodology_git_sha": row.get::<Option<String>, _>("methodology_git_sha"),
            "assets_toml_sha256": row.get::<String, _>("assets_toml_sha256"),
            "inputs_frozen": row.get::<serde_json::Value, _>("inputs_frozen"),
            "computed": row.get::<serde_json::Value, _>("computed"),
            "has_replay_artifact": !row.get::<Option<serde_json::Value>, _>("replay_artifact").is_none(),
            "receipt_sha256": row.get::<String, _>("receipt_sha256"),
            "onchain_tx_sig": row.get::<Option<String>, _>("onchain_tx_sig"),
            "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("evidence_at"),
        },
    });

    let headers = [
        (axum::http::header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
    ];
    Ok((headers, Json(body)))
}
```

**Why distinguishing `alert_not_found` vs `evidence_missing`**: the former is "this UUID never existed"; the latter is "alert exists but audit row missing (audit persist failed at the time)". Operators can `grep` logs for the latter to find data gaps.

---

## 4. `GET /v1/audit/:alert_id/replay-bundle`

```rust
pub async fn replay_bundle(
    State(state): State<Arc<AppState>>,
    Path(alert_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let id = Uuid::parse_str(&alert_id).map_err(/* invalid_uuid */)?;
    let bundle: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT replay_artifact FROM alert_evidence WHERE alert_id = $1"
    ).bind(id).fetch_optional(&state.pg).await?.flatten();

    let bundle = bundle.ok_or_else(|| {
        (StatusCode::NOT_FOUND, Json(json!({
            "error": "no_replay_artifact",
            "alert_id": alert_id,
            "hint": "non-critical alerts (DRIFT) have no artifact; receipt available at /v1/audit/<id>"
        })))
    })?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    headers.insert(header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"alert-{}.json\"", alert_id).parse().unwrap());
    headers.insert(header::CACHE_CONTROL, "public, max-age=31536000, immutable".parse().unwrap());

    Ok((StatusCode::OK, headers, Json(bundle)))
}
```

The `Content-Disposition: attachment` triggers a download dialog when accessed via browser. Curl gets the JSON body directly.

---

## 5. `GET /v1/audit/:alert_id/onchain`

```rust
pub async fn onchain(
    State(state): State<Arc<AppState>>,
    Path(alert_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let id = Uuid::parse_str(&alert_id).map_err(/* invalid_uuid */)?;
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT onchain_tx_sig FROM alert_evidence WHERE alert_id = $1"
    ).bind(id).fetch_optional(&state.pg).await?;
    let sig = row.and_then(|r| r.0).ok_or_else(|| {
        (StatusCode::NOT_FOUND, Json(json!({"error": "not_committed_yet", "alert_id": alert_id})))
    })?;
    Ok(Json(json!({
        "tx_sig": sig,
        "explorer_url": format!("https://solscan.io/tx/{}", sig),
    })))
}
```

Returns `not_committed_yet` if commit is async-pending (or wallet was unconfigured at alert time). Pollable by clients.

---

## 6. `GET /v1/audit` — index of recent audits

```rust
#[derive(serde::Deserialize)]
pub struct IndexParams {
    pub limit: Option<u32>,           // max 200, default 50
    pub exclude_pegged: Option<bool>, // default true
}

pub async fn index(
    State(state): State<Arc<AppState>>,
    Query(q): Query<IndexParams>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, Json<serde_json::Value>)> {
    let limit = q.limit.unwrap_or(50).min(200);
    let exclude_pegged = q.exclude_pegged.unwrap_or(true);
    let rows = sqlx::query(
        r#"SELECT a.id, a.asset, a.from_state::text AS from_state, a.to_state::text AS to_state,
                  a.detected_at, e.methodology_version, e.receipt_sha256, e.onchain_tx_sig
           FROM alerts a JOIN alert_evidence e ON e.alert_id = a.id
           WHERE ($1 = false OR a.to_state <> 'PEGGED')
           ORDER BY a.detected_at DESC LIMIT $2"#,
    )
    .bind(exclude_pegged)
    .bind(limit as i64)
    .fetch_all(&state.pg).await?;

    let json: Vec<serde_json::Value> = rows.into_iter().map(|row| json!({
        "id": row.get::<Uuid, _>("id").to_string(),
        "asset": row.get::<String, _>("asset"),
        "from_state": row.get::<String, _>("from_state"),
        "to_state": row.get::<String, _>("to_state"),
        "detected_at": row.get::<chrono::DateTime<chrono::Utc>, _>("detected_at"),
        "methodology_version": row.get::<String, _>("methodology_version"),
        "receipt_sha256": row.get::<String, _>("receipt_sha256"),
        "onchain_tx_sig": row.get::<Option<String>, _>("onchain_tx_sig"),
    })).collect();
    Ok(Json(json))
}
```

Used by `/audit` web page index AND by `/audit.xml` RSS feed (see `10-distribution.md § RSS/Atom feeds`).

---

## 7. `GET /v1/audit.csv` — streaming export

Uses `axum-streams` crate for chunked transfer encoding. Cursor-paginated internally to avoid OOM on large date ranges.

```rust
use axum_streams::StreamBodyAs;

#[derive(serde::Deserialize)]
pub struct CsvParams {
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
    pub asset: Option<String>,
}

#[derive(Serialize)]
pub struct AuditCsvRow {
    pub alert_id: String,
    pub asset: String,
    pub class: String,
    pub from_state: String,
    pub to_state: String,
    pub discount: String,
    pub intrinsic_usd: String,
    pub market_usd: String,
    pub confidence: String,
    pub detected_at: String,
    pub methodology_version: String,
    pub assets_toml_sha256: String,
    pub receipt_sha256: String,
    pub onchain_tx_sig: Option<String>,
}

pub async fn csv(
    State(state): State<Arc<AppState>>,
    Query(q): Query<CsvParams>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    if (q.to - q.from).num_days() > 366 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({
            "error": "date_range_too_large", "max_days": 366
        }))));
    }
    let pg = state.pg.clone();
    let asset = q.asset.clone();

    let stream = async_stream::stream! {
        let mut cursor: Option<DateTime<Utc>> = Some(q.to);
        const PAGE: i64 = 1000;
        loop {
            let upper = match cursor { Some(c) => c, None => break };
            let lower = q.from;
            let rows = match &asset {
                Some(a) => sqlx::query_as!(/* WHERE asset = $3 AND detected_at BETWEEN $1 AND $2 */)
                    .fetch_all(&pg).await,
                None => sqlx::query_as!(/* WHERE detected_at BETWEEN $1 AND $2 */)
                    .fetch_all(&pg).await,
            }.unwrap_or_default();
            let count = rows.len();
            for r in rows { yield r; }
            if count < PAGE as usize { break; }
            // advance cursor backward
            cursor = rows.last().map(|r| r.detected_at - chrono::Duration::microseconds(1));
        }
    };

    let filename = format!("pegana-audits-{}-{}.csv",
        q.from.format("%Y%m%d"), q.to.format("%Y%m%d"));
    let headers = [
        (axum::http::header::CONTENT_TYPE, "text/csv; charset=utf-8".to_string()),
        (axum::http::header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", filename)),
    ];
    Ok((headers, StreamBodyAs::csv(stream)))
}
```

**Rate limit**: existing IP-based 300/min covers this, but the per-request work is heavier. Consider tightening to 10/min for `/v1/audit.csv` only via tower middleware in a follow-up. Out of scope for v0.1.0.

---

## 8. CORS configuration

Adds tower-http CORS layer scoped to `/v1/assets/*` only (for the embed widget). All other routes remain same-origin only.

```rust
use tower_http::cors::{Any, CorsLayer};

// In main.rs router builder:
let public_cors = CorsLayer::new()
    .allow_origin(Any)
    .allow_methods([axum::http::Method::GET])
    .allow_headers(Any);

let public_router = Router::new()
    .route("/v1/assets", get(routes::assets::list))
    .route("/v1/assets/:symbol", get(routes::assets::detail))
    .layer(public_cors);

let app = Router::new()
    .merge(public_router)
    // ... rest of routes WITHOUT public CORS ...
    .route("/v1/audit/:alert_id", get(routes::audit::detail))
    .route("/v1/audit/:alert_id/replay-bundle", get(routes::audit::replay_bundle))
    .route("/v1/audit/:alert_id/onchain", get(routes::audit::onchain))
    .route("/v1/audit", get(routes::audit::index))
    .route("/v1/audit.csv", get(routes::audit::csv));
```

Audit endpoints intentionally NOT CORS-enabled. Reasoning: receipts are public via `/audit/[id]` web URLs; programmatic cross-origin access is a Phase 15 feature if a partner asks. Until then, server-to-server only.

---

## 9. OpenAPI changes

`crates/api-rs/src/openapi.rs` — add to `#[derive(OpenApi)]` `paths(...)`:

```rust
paths(
    // existing paths,
    crate::routes::audit::detail,
    crate::routes::audit::replay_bundle,
    crate::routes::audit::onchain,
    crate::routes::audit::index,
    crate::routes::audit::csv,
),
tags(
    // existing tags,
    (name = "audit", description = "Public receipts for alerts — methodology version, inputs frozen, replay bundles. All endpoints public, no auth, cacheable."),
)
```

Spec served at `/openapi.json`. Used by:
- TypeScript SDK gen (`@pegana/sdk-ts` via openapi-generator-cli)
- Python SDK gen (`pegana-sdk`)
- Manual Swagger UI inspection at `/docs` (if existing)

---

## 10. Test plan

`crates/api-rs/tests/audit_endpoint.rs` covers:

| Test | Scenario | Expected |
|---|---|---|
| `detail_returns_404_when_alert_missing` | unknown UUID | 404 `alert_not_found` |
| `detail_returns_evidence_missing_when_no_evidence_row` | alert exists, no evidence | 404 `evidence_missing` |
| `detail_returns_200_with_evidence` | both rows present | 200 with full payload |
| `replay_bundle_returns_404_for_drift` | DRIFT alert, no artifact | 404 `no_replay_artifact` |
| `replay_bundle_returns_200_with_attachment_header` | critical alert | 200 + Content-Disposition |
| `onchain_returns_404_when_pending` | alert without `onchain_tx_sig` yet | 404 `not_committed_yet` |
| `onchain_returns_200_with_explorer_url` | alert with sig populated | 200 + solscan URL |
| `index_returns_recent_audits` | seed 10 alerts + evidence | 200 array length 10 |
| `index_excludes_pegged_by_default` | mix of PEGGED + DRIFT | only DRIFT returned |
| `csv_streams_large_dataset_under_memory_cap` | 10k synthetic rows | 200 + memory < 100MB |
| `csv_rejects_large_date_range` | from-to > 366 days | 400 `date_range_too_large` |

All use `sqlx::test(migrations = "../../migrations")` for ephemeral Postgres setup.

---

## 11. Cross-references

- For the data being returned, see `04-data-model.md § JSONB schemas`.
- For the embed widget consuming `/v1/assets/*` via CORS, see `08-external-surfaces.md § Embed widget`.
- For the web `/audit/[id]` page that calls `/v1/audit/:id`, see `09-web-pages.md § /audit/[alert_id]`.
- For SDK generation, see `10-distribution.md § Auto-generated SDKs`.
- For tasks, see `plans/05-phase-4-api.md`.
- For acceptance criteria AC16-AC25, see `12-acceptance-criteria.md § API surface`.
