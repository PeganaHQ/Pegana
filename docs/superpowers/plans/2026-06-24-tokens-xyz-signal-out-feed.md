# tokens.xyz signal-out feed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public, mint-keyed `/v1/peg/feed` (batch) and `/v1/peg/feed/by-mint/:mint` (single) endpoint to `crates/api-rs` that exposes Pegana's peg signal in a clean, versioned shape the Solana Foundation's tokens.xyz product consumes.

**Architecture:** Pure read-only transform — no migration, no methodology change, no engine touch. Each `PegSignal` is a field-mapping of one existing `AssetCard` row from `assets::fetch_assets_list()`; three fields are derived in Rust (`discount_bps`, `stale`, `receipt_url`) plus the global `methodology` version. The batch is a `BTreeMap<mint, PegSignal>` (deterministic order); the per-mint path reuses `assets::fetch_card("a.mint", …)`.

**Tech Stack:** Rust, axum 0.7, utoipa (OpenAPI), sqlx/Postgres, rust_decimal, chrono, serde. Spec: `docs/superpowers/specs/2026-06-24-01-tokens-xyz-signal-out-feed.md`. Cross-spec allocations: `…00-overview-and-sequencing.md`.

**Branch:** create `feat/peg-signal-feed` off `main` before Task 1 (do not work on `main`).

> **STATUS — IMPLEMENTED + VERIFIED 2026-06-24** on branch `feat/peg-signal-feed`.
> `cargo build` + `cargo clippy --all-targets -- -D warnings` + `cargo fmt --check` clean;
> all 5 `peg.rs` unit tests + the OpenAPI guard (`paths.len() == 37`, unique op-ids,
> summaries) green; no migration touched. Two deltas vs the draft below, both verified:
> (1) `weak_etag` uses **sha2** (`Sha256::digest` → 128-bit hex), not `DefaultHasher` —
> stable across processes/Rust versions; (2) `card_to_signal`'s stale check uses
> `Option::is_none_or` (clippy `unnecessary_map_or`). The integration tests in Task 5 +
> Task 6 PASS in skip-mode (no `PEGANA_INTEGRATION_API_BASE`); the live end-to-end path
> (DB + CORS header + real 304) still needs a run against the prod-local stack.

---

## File Structure

- **Create** `crates/api-rs/src/routes/peg.rs` — the whole feature: `PegSignal`, `PegFeedResponse`, `card_to_signal`, `current_methodology_version`, handlers `feed` + `feed_by_mint`, unit tests.
- **Modify** `crates/api-rs/src/routes/mod.rs` — register `pub mod peg;`.
- **Modify** `crates/api-rs/src/routes/assets.rs:452` — widen `fetch_card` visibility to `pub(crate)` (reused by the per-mint handler).
- **Modify** `crates/api-rs/src/main.rs` — register two routes (~`:246`) + extend the CORS predicate (~`:174-181`).
- **Modify** `crates/api-rs/src/openapi.rs` — add 2 paths, 2 schemas, 1 tag, bump the path-count guard 35→37.
- **Create** `crates/api-rs/tests/peg_feed.rs` — env-gated integration tests.

---

### Task 1: `peg.rs` module + response types + registration

**Files:**
- Create: `crates/api-rs/src/routes/peg.rs`
- Modify: `crates/api-rs/src/routes/mod.rs:8-9`

- [ ] **Step 1: Write the failing test** (append to a new `peg.rs` `#[cfg(test)] mod tests`)

```rust
// crates/api-rs/src/routes/peg.rs  (test module — structs come in Step 3)
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pegsignal_omits_none_and_keeps_required() {
        let sig = PegSignal {
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".into(),
            symbol: "USDC".into(),
            name: "USD Coin".into(),
            class: "stable_fiat".into(),
            anchor: "USD".into(),
            peg_target: "USD".into(),
            decimals: 6,
            state: Some("PEGGED".into()),
            discount: None,
            discount_bps: None,
            intrinsic_usd: None,
            market_usd: None,
            confidence: Some("high".into()),
            calibration: "calibrated".into(),
            monitoring_only: false,
            worst_abs_24h: None,
            jitter_bps_24h: None,
            as_of: None,
            stale: true,
            methodology: "0.4.0".into(),
            receipt_url: "https://pegana.xyz/audit?asset=USDC".into(),
        };
        let v = serde_json::to_value(&sig).unwrap();
        // Required fields present.
        assert_eq!(v["mint"], "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
        assert_eq!(v["calibration"], "calibrated");
        assert_eq!(v["monitoring_only"], false);
        assert_eq!(v["stale"], true);
        assert_eq!(v["receipt_url"], "https://pegana.xyz/audit?asset=USDC");
        // None fields OMITTED (not null).
        assert!(v.get("discount").is_none());
        assert!(v.get("discount_bps").is_none());
        assert!(v.get("as_of").is_none());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p api-rs --lib routes::peg::tests::pegsignal_omits_none_and_keeps_required`
Expected: FAIL to COMPILE — `cannot find type PegSignal` (module not declared / struct missing).

- [ ] **Step 3: Write minimal implementation** — top of `crates/api-rs/src/routes/peg.rs`

```rust
//! `/v1/peg/feed` — Pegana's peg signal in a mint-keyed shape for tokens.xyz.
//!
//! A read-only transform of the existing `/v1/assets` data (`AssetCard`) into a
//! purpose-built, versioned contract keyed by Solana mint. No new SQL, no
//! migration, no methodology impact. The Foundation's tokens.xyz product joins
//! `data[<mint>]` into its per-currency buckets; `tokens_variant` is THEIRS and
//! is not emitted here. Contract: docs/superpowers/specs/2026-06-24-01-*.md.

use crate::error::ApiError;
use crate::routes::assets::{fetch_assets_list, fetch_card, AssetCard};
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue},
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::Arc;
use utoipa::ToSchema;

/// One asset's peg signal. A superset of the tokens.xyz contract subset; every
/// `Option` field is omitted (not null) when absent so a thin consumer can model
/// only what it needs.
#[derive(Debug, Serialize, ToSchema)]
pub struct PegSignal {
    /// Canonical Solana mint — also the `data` map key in the batch response.
    pub mint: String,
    pub symbol: String,
    pub name: String,
    pub class: String,
    /// USD | FX | NAV — how to read fair value without Pegana's taxonomy.
    #[schema(value_type = crate::schema::Anchor)]
    pub anchor: String,
    pub peg_target: String,
    pub decimals: i16,
    /// PEGGED..BLACK_SWAN | UNKNOWN. Omitted when there is no current snapshot.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::schema::PegState>)]
    pub state: Option<String>,
    /// Signed discount fraction (serialized as a string).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discount: Option<Decimal>,
    /// Convenience `discount × 10000` as a number (consumer rounds). Raw.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discount_bps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intrinsic_usd: Option<Decimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub market_usd: Option<Decimal>,
    /// Pyth confidence bucket: high | medium | low | unknown. Omitted when no snapshot.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::schema::Confidence>)]
    pub confidence: Option<String>,
    /// provisional | calibrated. Always present.
    #[schema(value_type = crate::schema::Calibration)]
    pub calibration: String,
    pub monitoring_only: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worst_abs_24h: Option<Decimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jitter_bps_24h: Option<Decimal>,
    /// RFC3339 of the latest snapshot (= `updated_at`). Omitted when none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub as_of: Option<String>,
    /// True when `as_of` is older than the 15-min freshness bound, or absent.
    pub stale: bool,
    /// Active methodology version (global), e.g. `0.4.0`.
    pub methodology: String,
    /// Human/agent verify pointer for this asset.
    pub receipt_url: String,
}

/// Batch envelope, keyed by mint. tokens.xyz merges `data[<mint>]` into its own
/// per-currency buckets.
#[derive(Debug, Serialize, ToSchema)]
pub struct PegFeedResponse {
    pub ok: bool,
    pub methodology: String,
    /// RFC3339 build time — an explicit staleness read independent of HTTP headers.
    pub generated_at: String,
    pub count: usize,
    pub data: BTreeMap<String, PegSignal>,
}
```

Then declare the module — `crates/api-rs/src/routes/mod.rs`, insert between line 8 (`pub mod methodology;`) and line 9 (`pub mod stats;`):

```rust
pub mod peg;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p api-rs --lib routes::peg::tests::pegsignal_omits_none_and_keeps_required`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/api-rs/src/routes/peg.rs crates/api-rs/src/routes/mod.rs
git commit -m "feat(api): peg-feed PegSignal/PegFeedResponse types + module"
```

---

### Task 2: `card_to_signal` transform + `current_methodology_version`

**Files:**
- Modify: `crates/api-rs/src/routes/peg.rs` (add functions + tests)

- [ ] **Step 1: Write the failing test** (add to the `tests` module in `peg.rs`)

```rust
    use crate::routes::assets::AssetCard;
    use rust_decimal::Decimal;
    use std::str::FromStr;

    fn sample_card() -> AssetCard {
        AssetCard {
            symbol: "jitoSOL".into(),
            name: "Jito Staked SOL".into(),
            mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn".into(),
            class: "lst".into(),
            anchor: "NAV".into(),
            peg_target: "SOL".into(),
            decimals: 9,
            state: Some("PEGGED".into()),
            discount: Some(Decimal::from_str("-0.007405").unwrap()),
            intrinsic_usd: Some(Decimal::from_str("180.5").unwrap()),
            market_usd: Some(Decimal::from_str("179.2").unwrap()),
            updated_at: None,
            series_24h: None,
            sol_per_lst: None,
            confidence: Some("high".into()),
            thresholds: None,
            monitoring_only: false,
            monitoring_reason: None,
            monitoring_since: None,
            calibration: "calibrated".into(),
            worst_abs_24h: None,
            jitter_bps_24h: None,
        }
    }

    #[test]
    fn card_to_signal_derives_bps_receipt_and_stale() {
        let now = "2026-06-24T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let sig = card_to_signal(sample_card(), "0.4.0", now);
        // discount_bps = discount × 10000 (raw, unrounded).
        let bps = sig.discount_bps.unwrap();
        assert!((bps - (-74.05)).abs() < 1e-9, "got {bps}");
        // receipt_url is per-symbol.
        assert_eq!(sig.receipt_url, "https://pegana.xyz/audit?asset=jitoSOL");
        // No updated_at => no as_of, and stale=true (no fresh signal).
        assert!(sig.as_of.is_none());
        assert!(sig.stale);
        assert_eq!(sig.methodology, "0.4.0");
    }

    #[test]
    fn card_to_signal_fresh_vs_stale_window() {
        let now = "2026-06-24T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let mut fresh = sample_card();
        fresh.updated_at = Some("2026-06-24T11:55:00Z".parse().unwrap()); // 5 min ago
        assert!(!card_to_signal(fresh, "0.4.0", now).stale);

        let mut old = sample_card();
        old.updated_at = Some("2026-06-24T11:40:00Z".parse().unwrap()); // 20 min ago
        let sig = card_to_signal(old, "0.4.0", now);
        assert!(sig.stale);
        assert_eq!(sig.as_of.as_deref(), Some("2026-06-24T11:40:00+00:00"));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p api-rs --lib routes::peg::tests::card_to_signal`
Expected: FAIL to COMPILE — `cannot find function card_to_signal`.

- [ ] **Step 3: Write minimal implementation** (add to `peg.rs`, after the structs)

```rust
/// 15-minute current-snapshot freshness bound (mirrors `assets.rs` / `ASSETS_LIST_SQL`).
const FRESHNESS_MINUTES: i64 = 15;

/// Pure field-map of one `AssetCard` → `PegSignal`. `methodology` is the global
/// version; `now` is injected so it's testable.
fn card_to_signal(card: AssetCard, methodology: &str, now: DateTime<Utc>) -> PegSignal {
    let receipt_url = format!("https://pegana.xyz/audit?asset={}", card.symbol);
    let discount_bps = card
        .discount
        .and_then(|d| d.to_f64())
        .map(|x| x * 10_000.0);
    let stale = card
        .updated_at
        .map_or(true, |t| (now - t).num_minutes() >= FRESHNESS_MINUTES);
    let as_of = card.updated_at.map(|t| t.to_rfc3339());
    PegSignal {
        mint: card.mint,
        symbol: card.symbol,
        name: card.name,
        class: card.class,
        anchor: card.anchor,
        peg_target: card.peg_target,
        decimals: card.decimals,
        state: card.state,
        discount: card.discount,
        discount_bps,
        intrinsic_usd: card.intrinsic_usd,
        market_usd: card.market_usd,
        confidence: card.confidence,
        calibration: card.calibration,
        monitoring_only: card.monitoring_only,
        worst_abs_24h: card.worst_abs_24h,
        jitter_bps_24h: card.jitter_bps_24h,
        as_of,
        stale,
        methodology: methodology.to_string(),
        receipt_url,
    }
}

/// Latest released methodology version (mirrors `methodology::current`'s query),
/// falling back to the seeded baseline on an un-migrated DB.
async fn current_methodology_version(pg: &sqlx::PgPool) -> String {
    sqlx::query_scalar::<_, String>(
        "SELECT version FROM methodology_versions ORDER BY released_at DESC LIMIT 1",
    )
    .fetch_optional(pg)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "0.1.0".to_string())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p api-rs --lib routes::peg::tests::card_to_signal`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add crates/api-rs/src/routes/peg.rs
git commit -m "feat(api): peg-feed card_to_signal transform + methodology-version helper"
```

---

### Task 3: batch `feed` handler + route + OpenAPI + CORS

**Files:**
- Modify: `crates/api-rs/src/routes/peg.rs` (add `feed`)
- Modify: `crates/api-rs/src/main.rs:246` (route), `:174-181` (CORS)
- Modify: `crates/api-rs/src/openapi.rs` (path, schemas, tag, count 35→36)

- [ ] **Step 1: Write the failing test** (extend the OpenAPI guard expectation; add to `peg.rs` tests)

```rust
    #[test]
    fn feed_response_is_mint_keyed_with_count() {
        let now = "2026-06-24T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let card = sample_card();
        let mint = card.mint.clone();
        let mut data = std::collections::BTreeMap::new();
        data.insert(mint.clone(), card_to_signal(card, "0.4.0", now));
        let resp = PegFeedResponse {
            ok: true,
            methodology: "0.4.0".into(),
            generated_at: now.to_rfc3339(),
            count: data.len(),
            data,
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["count"], 1);
        // Keyed by mint, not symbol.
        assert!(v["data"].get(&mint).is_some());
        assert_eq!(v["data"][&mint]["symbol"], "jitoSOL");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p api-rs --lib routes::peg::tests::feed_response_is_mint_keyed_with_count`
Expected: PASS already (types exist) — this guards the envelope shape. If it does not compile, fix the test imports. (This task's behavioral proof is the integration test in Task 5; the handler itself needs a live DB.)

- [ ] **Step 3: Write the handler** (add to `peg.rs`)

```rust
#[utoipa::path(
    get,
    path = "/v1/peg/feed",
    tag = "peg",
    operation_id = "peg_feed",
    summary = "Batch peg signal for every active asset, keyed by mint",
    responses(
        (status = 200, description = "Peg signal for all active assets, keyed by Solana mint", body = PegFeedResponse)
    )
)]
pub async fn feed(State(state): State<Arc<AppState>>) -> Result<impl IntoResponse, ApiError> {
    let methodology = current_methodology_version(&state.pg).await;
    let cards = fetch_assets_list(&state.pg, None, None)
        .await
        .map_err(ApiError::db)?;
    let now = Utc::now();
    let mut data: BTreeMap<String, PegSignal> = BTreeMap::new();
    for card in cards {
        // Mint is the join key; an asset without one can't be consumed by
        // tokens.xyz and would collide on the empty string. Skip it.
        if card.mint.is_empty() {
            continue;
        }
        let mint = card.mint.clone();
        data.insert(mint, card_to_signal(card, &methodology, now));
    }
    let body = PegFeedResponse {
        ok: true,
        methodology,
        generated_at: now.to_rfc3339(),
        count: data.len(),
        data,
    };
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=5, stale-while-revalidate=10"),
    );
    Ok((headers, Json(body)))
}
```

Register the route — `crates/api-rs/src/main.rs`, immediately after the `/v1/assets/by-mint/:mint/state` route block (ends line 246), before `.route("/v1/alerts", …)`:

```rust
        .route("/v1/peg/feed", get(routes::peg::feed))
```

Extend the CORS predicate — `crates/api-rs/src/main.rs`, inside the `if path.starts_with(...)` chain (after the `|| path.starts_with("/v1/meta")` line 179):

```rust
                || path.starts_with("/v1/peg")
```

Register in OpenAPI — `crates/api-rs/src/openapi.rs`:
- In `paths(...)`, after `crate::routes::methodology::current,` (line 127):
  ```rust
          // tokens.xyz signal-out feed (mint-keyed peg signal).
          crate::routes::peg::feed,
  ```
- In `components(schemas(...))`, after `crate::routes::methodology::MethodologyCurrentResponse,` (line 176):
  ```rust
          crate::routes::peg::PegSignal,
          crate::routes::peg::PegFeedResponse,
  ```
- In `tags(...)`, after the `methodology` tag (line 216):
  ```rust
          (name = "peg", description = "Mint-keyed peg-signal feed for tokens.xyz / aggregator consumption. Public, no auth, cacheable. Honest beta status via `calibration` + `monitoring_only`; freshness via `as_of` + `stale`."),
  ```
- Bump the path-count guard — `openapi.rs:479`, `35` → `36` (one new path-item: `/v1/peg/feed`).

- [ ] **Step 4: Verify the crate compiles + OpenAPI guard tests pass**

Run: `cargo test -p api-rs --lib openapi`
Expected: PASS — `operation_ids_are_unique`, `every_operation_has_summary`, and the count assertion (now 36) all green.
Run: `cargo build -p api-rs`
Expected: builds clean.

- [ ] **Step 5: Commit**

```bash
git add crates/api-rs/src/routes/peg.rs crates/api-rs/src/main.rs crates/api-rs/src/openapi.rs
git commit -m "feat(api): GET /v1/peg/feed batch peg-signal feed (mint-keyed) + CORS + OpenAPI"
```

---

### Task 4: per-mint `feed_by_mint` handler

**Files:**
- Modify: `crates/api-rs/src/routes/assets.rs:452` (`fetch_card` → `pub(crate)`)
- Modify: `crates/api-rs/src/routes/peg.rs` (add `feed_by_mint`)
- Modify: `crates/api-rs/src/main.rs` (route), `openapi.rs` (path, count 36→37)

- [ ] **Step 1: Widen `fetch_card` visibility** — `crates/api-rs/src/routes/assets.rs:452`

Change:
```rust
async fn fetch_card(
```
to:
```rust
pub(crate) async fn fetch_card(
```

- [ ] **Step 2: Write the handler** — add to `peg.rs`

```rust
#[utoipa::path(
    get,
    path = "/v1/peg/feed/by-mint/{mint}",
    tag = "peg",
    operation_id = "peg_feed_by_mint",
    summary = "Peg signal for a single asset by mint",
    params(
        ("mint" = String, Path, description = "SPL mint address (base58) — the tokens.xyz join key.")
    ),
    responses(
        (status = 200, description = "Peg signal for the asset", body = PegSignal),
        (status = 404, description = "No active asset with that mint", body = ApiError)
    )
)]
pub async fn feed_by_mint(
    State(state): State<Arc<AppState>>,
    Path(mint): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let methodology = current_methodology_version(&state.pg).await;
    let card = fetch_card(&state.pg, "a.mint", &mint)
        .await?
        .ok_or_else(|| ApiError::unknown_asset(&mint))?;
    let signal = card_to_signal(card, &methodology, Utc::now());
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=5, stale-while-revalidate=10"),
    );
    Ok((headers, Json(signal)))
}
```

Register the route — `main.rs`, immediately after the `/v1/peg/feed` route added in Task 3:

```rust
        .route(
            "/v1/peg/feed/by-mint/:mint",
            get(routes::peg::feed_by_mint),
        )
```

Register in OpenAPI `paths(...)` — after `crate::routes::peg::feed,`:
```rust
        crate::routes::peg::feed_by_mint,
```
Bump the path-count guard — `openapi.rs:479`, `36` → `37`.

- [ ] **Step 3: Verify compile + OpenAPI guards**

Run: `cargo test -p api-rs --lib openapi`
Expected: PASS — count now 37; both `peg_feed` and `peg_feed_by_mint` have unique operation_ids + summaries.

- [ ] **Step 4: Full crate check**

Run: `cargo fmt -p api-rs && cargo clippy -p api-rs -- -D warnings && cargo test -p api-rs --lib`
Expected: fmt clean, clippy clean, all unit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/api-rs/src/routes/assets.rs crates/api-rs/src/routes/peg.rs crates/api-rs/src/main.rs crates/api-rs/src/openapi.rs
git commit -m "feat(api): GET /v1/peg/feed/by-mint/:mint single peg signal"
```

---

### Task 5: env-gated integration tests

**Files:**
- Create: `crates/api-rs/tests/peg_feed.rs`

> Mirror the gating convention already used in `crates/api-rs/tests/http_endpoints.rs`. If that file reads a different base-URL env var than `PEGANA_INTEGRATION_API_BASE`, use that var name instead — the test must SKIP (return early) when the var is unset so CI without a live stack stays green.

- [ ] **Step 1: Write the integration test**

```rust
//! Integration tests for the tokens.xyz signal-out feed. Env-gated: set
//! PEGANA_INTEGRATION_API_BASE to a running API (e.g. http://localhost:8081)
//! to exercise. Skips cleanly when unset.

fn base() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_API_BASE").ok()
}

#[tokio::test]
async fn batch_feed_is_mint_keyed_and_resolvable() {
    let Some(base) = base() else {
        eprintln!("skip: PEGANA_INTEGRATION_API_BASE unset");
        return;
    };
    let body: serde_json::Value = reqwest::get(format!("{base}/v1/peg/feed"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body["ok"], true);
    assert!(body["count"].as_u64().unwrap() >= 1);
    let data = body["data"].as_object().unwrap();
    // Every key is a base58 mint; pick one and confirm the per-mint endpoint
    // returns the SAME object.
    let (mint, first) = data.iter().next().unwrap();
    let one: serde_json::Value = reqwest::get(format!("{base}/v1/peg/feed/by-mint/{mint}"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(one["symbol"], first["symbol"]);
    assert_eq!(one["mint"], *mint);
    // Honesty fields present on every row.
    assert!(first["calibration"].is_string());
    assert!(first["monitoring_only"].is_boolean());
    assert!(first["methodology"].is_string());
}

#[tokio::test]
async fn unknown_mint_is_404_json() {
    let Some(base) = base() else { return };
    let resp = reqwest::get(format!("{base}/v1/peg/feed/by-mint/NotARealMint11111111111111111111111111111"))
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["error"], "unknown_asset");
}

#[tokio::test]
async fn feed_allows_cross_origin() {
    let Some(base) = base() else { return };
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{base}/v1/peg/feed"))
        .header("Origin", "https://app.tokens.xyz")
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.headers()
            .get("access-control-allow-origin")
            .and_then(|v| v.to_str().ok()),
        Some("https://app.tokens.xyz")
    );
}
```

- [ ] **Step 2: Run (skips without a stack)**

Run: `cargo test -p api-rs --test peg_feed`
Expected: PASS (tests early-return/skip when `PEGANA_INTEGRATION_API_BASE` is unset).

- [ ] **Step 3: (Optional) run against the local prod-local stack**

Run: `PEGANA_INTEGRATION_API_BASE=http://localhost:8081 cargo test -p api-rs --test peg_feed`
Expected: PASS against a running API — batch + per-mint agree, unknown mint 404, CORS echoes the origin.

- [ ] **Step 4: Commit**

```bash
git add crates/api-rs/tests/peg_feed.rs
git commit -m "test(api): env-gated integration tests for /v1/peg/feed"
```

---

### Task 6: ETag + Last-Modified + 304 (high-volume polling)

**Files:**
- Modify: `crates/api-rs/src/routes/peg.rs` (rewrite `feed` to add conditional handling)

- [ ] **Step 1: Write the failing test** (add to `peg.rs` tests)

```rust
    #[test]
    fn weak_etag_is_deterministic_and_changes_with_body() {
        let a = weak_etag("{\"count\":1}");
        let b = weak_etag("{\"count\":1}");
        let c = weak_etag("{\"count\":2}");
        assert_eq!(a, b, "same body => same etag");
        assert_ne!(a, c, "different body => different etag");
        assert!(a.starts_with("W/\""), "weak etag form: {a}");
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p api-rs --lib routes::peg::tests::weak_etag_is_deterministic_and_changes_with_body`
Expected: FAIL to COMPILE — `cannot find function weak_etag`.

- [ ] **Step 3: Implement `weak_etag` + rewrite `feed`** (replace the whole `feed` fn from Task 3 and add the helper)

```rust
use axum::http::StatusCode;
use axum::response::Response;
use std::hash::{Hash, Hasher};

/// Deterministic weak ETag over the serialized body. `DefaultHasher` uses fixed
/// keys, so the token is stable across processes/instances (safe for 304s).
fn weak_etag(body: &str) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    body.hash(&mut h);
    format!("W/\"{:016x}\"", h.finish())
}

#[utoipa::path(
    get,
    path = "/v1/peg/feed",
    tag = "peg",
    operation_id = "peg_feed",
    summary = "Batch peg signal for every active asset, keyed by mint",
    responses(
        (status = 200, description = "Peg signal for all active assets, keyed by Solana mint", body = PegFeedResponse),
        (status = 304, description = "Not modified (If-None-Match matched the current ETag)")
    )
)]
pub async fn feed(
    State(state): State<Arc<AppState>>,
    req_headers: HeaderMap,
) -> Result<Response, ApiError> {
    let methodology = current_methodology_version(&state.pg).await;
    let cards = fetch_assets_list(&state.pg, None, None)
        .await
        .map_err(ApiError::db)?;
    let now = Utc::now();
    // Newest snapshot across assets → Last-Modified (HTTP-date, UTC).
    let mut last_modified: Option<DateTime<Utc>> = None;
    let mut data: BTreeMap<String, PegSignal> = BTreeMap::new();
    for card in cards {
        if card.mint.is_empty() {
            continue;
        }
        if let Some(u) = card.updated_at {
            last_modified = Some(last_modified.map_or(u, |m| m.max(u)));
        }
        let mint = card.mint.clone();
        data.insert(mint, card_to_signal(card, &methodology, now));
    }
    let body = PegFeedResponse {
        ok: true,
        methodology,
        generated_at: now.to_rfc3339(),
        count: data.len(),
        data,
    };
    let json = serde_json::to_string(&body).map_err(ApiError::internal)?;
    let etag = weak_etag(&json);

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=5, stale-while-revalidate=10"),
    );
    if let Ok(v) = HeaderValue::from_str(&etag) {
        headers.insert(header::ETAG, v);
    }
    if let Some(lm) = last_modified {
        if let Ok(v) = HeaderValue::from_str(&lm.format("%a, %d %b %Y %H:%M:%S GMT").to_string()) {
            headers.insert(header::LAST_MODIFIED, v);
        }
    }

    // Conditional GET — return 304 (no body) when the client's ETag matches.
    if let Some(inm) = req_headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
    {
        if inm == etag {
            return Ok((StatusCode::NOT_MODIFIED, headers).into_response());
        }
    }

    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    Ok((headers, json).into_response())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p api-rs --lib routes::peg && cargo clippy -p api-rs -- -D warnings`
Expected: PASS — `weak_etag` test green, all prior peg tests still green, clippy clean.

- [ ] **Step 5: Commit**

```bash
git add crates/api-rs/src/routes/peg.rs
git commit -m "feat(api): ETag + Last-Modified + 304 on /v1/peg/feed for high-volume polling"
```

---

## Final verification (run before opening a PR)

- [ ] `cargo fmt --all --check`
- [ ] `cargo clippy -p api-rs -- -D warnings`
- [ ] `cargo test -p api-rs` (lib + tests; integration tests skip without a stack)
- [ ] `git diff --stat migrations/` is EMPTY (no migration — read path)
- [ ] `/openapi.json` lists `peg_feed` + `peg_feed_by_mint` with unique operationIds and non-empty summaries; OpenAPI path-count guard = 37
- [ ] (Optional, with stack) `PEGANA_INTEGRATION_API_BASE=http://localhost:8081 cargo test -p api-rs --test peg_feed`

---

## Self-Review (against the spec)

**Spec coverage:**
- `/v1/peg/feed` batch + `/v1/peg/feed/by-mint/:mint` → Tasks 3, 4. ✓
- Mint-keyed envelope `{ok, methodology, generated_at, count, data}` → Task 3. ✓
- `PegSignal` exact field provenance (incl. derived `discount_bps`, `stale`, `as_of`, `receipt_url`, global `methodology`) → Tasks 1, 2. ✓
- No `tokens_variant`, no currency-bucket grouping → by construction (flat `data` map). ✓
- CORS predicate `/v1/peg` → Task 3. ✓
- OpenAPI paths/components/tags + count 35→37 → Tasks 3, 4. ✓
- `receipt_url = https://pegana.xyz/audit?asset=<symbol>` → Task 2. ✓
- Honesty fields (`calibration`, `monitoring_only`, `as_of`, `stale`) on every row → Tasks 2, 5. ✓
- Cache-Control + ETag/Last-Modified/304 → Tasks 3, 6. ✓
- No migration, no methodology bump → confirmed in final verification. ✓
- Skip empty-mint assets (collision guard) → Task 3. ✓

**Placeholder scan:** none — every code step shows full code; the only deferred detail is the integration-test env-var name, explicitly flagged to match `http_endpoints.rs`.

**Type consistency:** `card_to_signal(AssetCard, &str, DateTime<Utc>) -> PegSignal`, `current_methodology_version(&PgPool) -> String`, `weak_etag(&str) -> String`, `fetch_card` → `pub(crate)` — names/signatures consistent across Tasks 1-6. `PegSignal`/`PegFeedResponse` field names match the spec's provenance table.

**Out of scope (correctly deferred):** `?anchor=`/`?state=` batch filters (spec lists them as optional v1 niceties — add later if tokens.xyz asks); allowlisted-IP rate-limit lane (future). Neither blocks the contract.
