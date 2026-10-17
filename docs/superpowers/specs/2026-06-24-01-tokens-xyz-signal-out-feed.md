# Spec 01 — tokens.xyz signal-out feed (`/v1/peg/feed`)

**Wave 1 · api-rs · no migration · no methodology bump.** Highest distribution leverage:
puts Pegana's peg signal — which tokens.xyz lacks — inside the Foundation's product.

## Problem / context

tokens.xyz has the full Solana asset universe but NO peg signal; Pegana is net-new for
them (the @stevensarmi inbound). They key data by **Solana mint**. We expose a clean,
versioned, purpose-built feed they can join on mint — decoupled from the dashboard's
`AssetCard` so the contract can evolve independently.

**The contract already exists, validated by Rafael:** `docs/strategy/2026-06-22-tokens-xyz-sample-LIVE.json`
and `docs/strategy/tokens-xyz-peg-include-LIVE.json` are hand-built target shapes
(mint-keyed, `{peg:{ok,data:{<mint>:{...}}}}`). **Hand these two files to Codex as the
contract.** Mint-keyed lookups already ship: `/v1/assets/by-mint/:mint` (`assets.rs:409`).

## Goals / non-goals

- **Goal:** a public, unauthenticated, cache-friendly batch feed + per-mint lookup that
  tokens.xyz can poll at volume, carrying state/discount/confidence/calibration +
  verifiable pointers (methodology version, receipt URL).
- **Non-goal:** a new data pipeline (pure read transform of existing `/v1/assets` data);
  echoing tokens.xyz's own enrichment (`tokens_variant`); paging (≤63 assets).

## Design (decisions made)

Two public read endpoints under a dedicated `/v1/peg` namespace:
- `GET /v1/peg/feed` → batch, all active assets, **keyed by mint**.
- `GET /v1/peg/feed/by-mint/:mint` → single asset (the hot "enrich one token page" path).

New module `crates/api-rs/src/routes/peg.rs`. Build `PegSignal` by transforming the
existing `assets::fetch_assets_list()` output (`assets.rs:338`, already `pub`) — **single
source of truth, zero new SQL.**

**`PegSignal` — exact field provenance (locked against the real `AssetCard`,
`assets.rs:43-149`).** Every field is a pure transform of one `fetch_assets_list()` row —
NO new SQL. `?` = `skip_serializing_if=Option::is_none` (mirror `new_fields_omitted_when_none`).

| PegSignal field | Type | Source on `AssetCard` | Note |
|---|---|---|---|
| `mint` | string | `mint` | also the `data` map key |
| `symbol` | string | `symbol` | |
| `name` | string | `name` | |
| `class` | string | `class` | |
| `anchor` | enum USD\|FX\|NAV | `anchor` | |
| `peg_target` | string | `peg_target` | |
| `decimals` | i16 | `decimals` | |
| `state?` | enum PEGGED..BLACK_SWAN\|UNKNOWN | `state` (Option) | omit when None (no snapshot) |
| `discount?` | decimal string | `discount` | signed fraction |
| `discount_bps?` | number | **DERIVED** = `discount × 10000` | convenience; raw (consumer rounds) |
| `intrinsic_usd?` | decimal string | `intrinsic_usd` | |
| `market_usd?` | decimal string | `market_usd` | |
| `confidence?` | enum high\|medium\|low\|unknown | `confidence` | |
| `calibration` | enum provisional\|calibrated | `calibration` | always present |
| `monitoring_only` | bool | `monitoring_only` | always present |
| `worst_abs_24h?` | decimal string | `worst_abs_24h` | |
| `jitter_bps_24h?` | decimal string | `jitter_bps_24h` | |
| `as_of?` | RFC3339 | `updated_at` (Option) | omit when None |
| `stale` | bool | **DERIVED** = `updated_at` older than 15-min bound (mirror `assets.rs:771`) | always present |
| `methodology` | string | **DERIVED** global from `methodology_versions` (latest by `released_at`) | e.g. `0.4.0` |
| `receipt_url` | string | **DERIVED** = `https://pegana.xyz/audit?asset=<symbol>` | the verify pointer |

**Contract resolution (the two validated samples disagree — locked here):** the newer flat
sample (`2026-06-22…`) is symbol-keyed with `verify_url`; the `…include-LIVE` sample is
**mint-keyed** with `receipt_url` + currency-bucket grouping + `tokens_variant`. Decisions:
- **Key by mint, flat `data` map** (NOT currency-bucketed — the buckets are tokens.xyz's own
  structure; they merge our `data[<mint>]` into their buckets).
- **Field name `receipt_url`** (matches the mint-keyed sample; more descriptive than `verify_url`).
- **Do NOT emit `tokens_variant`** (their join enrichment, not ours).
- The per-asset object is a SUPERSET of the include sample's Pegana-origin subset
  (`symbol,state,discount,discount_bps,calibration,confidence,as_of,methodology,receipt_url`)
  plus the richer `AssetCard` fields. tokens.xyz can ignore extras; all are additive/optional,
  so the exact subset can be trimmed to Steven's final ask with no structural change.

**Batch envelope** (matches the validated `peg.ok/data` shape):
```json
{ "ok": true, "methodology": "0.4.0", "generated_at": "…Z", "count": 63,
  "data": { "<mint>": { …PegSignal… } } }
```
Per-mint endpoint returns a bare `PegSignal` (200) or `ApiError::unknown_asset` (404, JSON).

**Decided open questions:**
- **Namespace:** `/v1/peg/feed` (+ `/by-mint/:mint`).
- **Key:** mint (per tokens.xyz join), with the `{ok,methodology,generated_at,count,data}` envelope.
- **`receipt_url`:** `https://pegana.xyz/audit?asset=<symbol>` (the validated sample uses this; per-asset receipts are per-alert so no single hash is embedded — link, don't embed).
- **`tokens_variant`:** do NOT echo it (it's their data).
- **Filters:** ship `?anchor=USD|FX|NAV` and `?state=` as cheap in-memory post-cache filters.
- **High volume:** rely on the existing 5s Redis cache + `Cache-Control` + add `ETag`/`Last-Modified` so polling returns cheap 304s. An allowlisted-IP / higher-limit lane for the Foundation egress is a **future** item, not v1. Do NOT remove the global 300/min limiter.

**Caching:** transform from `fetch_assets_list()` (already 5s-cached + pre-warmed,
`main.rs:132-145`). Set `Cache-Control: public, max-age=5, stale-while-revalidate=10` on
batch, `max-age=5` on per-mint. Add `Last-Modified` = max `updated_at`, weak `ETag` =
hash of serialized body, honor `If-None-Match`/`If-Modified-Since` → 304.

## Files to touch (exact)

- **NEW** `crates/api-rs/src/routes/peg.rs` — `PegSignal`, `PegFeedResponse`, handlers `feed`/`feed_by_mint`, each `#[utoipa::path(... operation_id="peg_feed"/"peg_feed_by_mint" ...)]`.
- `crates/api-rs/src/routes/mod.rs:1-11` — `pub mod peg;`.
- `crates/api-rs/src/main.rs` — add both `.route(...)` (near assets routes ~`:235-246`); **extend the CORS predicate** (`:174-181`) with `|| path.starts_with("/v1/peg")`.
- `crates/api-rs/src/openapi.rs` — add both handlers to `paths(...)` (after `:109`); add `PegSignal`+`PegFeedResponse` to `components(schemas(...))` (after `:156`); optional `peg` tag; **BUMP the pinned path-count assertion `35 → 37` (`openapi.rs:479`)** ← the single highest-risk line, CI fails otherwise; update stale `info.description` "26 active mainnet assets" → current count (`:74`).
- **NEW** `crates/api-rs/tests/peg_feed.rs` — integration (env-gated, mirror `http_endpoints.rs`) + unit tests in `peg.rs`.

Reuse as-is: `error.rs`, `extract.rs` (`ValQuery`), `rate_limit.rs`, `schema.rs` (`Anchor/PegState/Confidence/Calibration` via `#[schema(value_type=...)]`).

## Schema / migrations

**None.** Pure read over `assets`, `discount_snapshots`, `intrinsic_snapshots`, `discount_1m`,
`methodology_versions` — all existing. `assets.mint` is `NOT NULL UNIQUE` (`0001_initial.sql:30`) → mint key is collision-safe. `git diff migrations/` must be empty.

## Methodology / receipt / version impact

None. Read-only API; no engine, no receipt, no methodology change.

## Risks

- **Honesty:** every row MUST carry `calibration` + `monitoring_only` + `as_of` + `stale`. Never present a `provisional` asset as a calibrated verdict; never emit state/confidence without the timestamp that lets a consumer judge freshness (engine stops writing on stale feeds — frozen `as_of` is the only staleness signal).
- **Abuse:** public + unauth. Mitigated by 5s cache + ETag/304. Keep the limiter.
- **OpenAPI count guard regression** (`openapi.rs:479`) — call it out explicitly to Codex.
- **What NOT to expose:** internal `intrinsic_cfg`/`market_cfg`/`pyth_feed_id`, raw `alert_evidence`, any user/chat data (none here — asset data only).

## Test plan + acceptance criteria

- Unit: `PegSignal` serializes with mint/symbol/state/anchor/calibration present; optional fields OMITTED (not null) when None; batch keyed by mint; `count==data.len()`; `discount` is a string, `discount_bps` a number.
- OpenAPI guards stay green: unique operationIds (explicit), every-op-has-summary, path-count → 37.
- Integration (env-gated): batch 200 + JSON + envelope + every row's mint resolves via `/v1/assets/by-mint/:mint`; per-mint 200 == batch row; unknown mint → 404 JSON `unknown_asset`; CORS echoes arbitrary Origin on `/v1/peg`; `ETag`/`Last-Modified` present; conditional GET → 304; `Cache-Control` present.
- **Acceptance:** `cargo test -p api-rs` + fmt + clippy green; `/openapi.json` lists both ops; batch is field-compatible with the two validated sample JSONs; every row carries calibration/monitoring_only/as_of/methodology/receipt_url; no new migration.

## Grill outcomes (`/grill-with-docs` + `/grill-me`)

- *"Is a separate `/v1/peg` namespace justified vs reusing `/v1/assets`?"* — Yes: tokens.xyz needs a stable, purpose-built contract; coupling to `AssetCard` would force their integration to break on dashboard changes. The validated sample already implies a distinct shape.
- *"Does this leak the pre-launch ledger / monitoring-only honestly?"* — `feature_public_alerts` does not gate `/v1/assets` (already public); the feed mirrors that and stamps `calibration`/`monitoring_only` explicitly, consistent with the 2026-06-16 beta release (suppress→label).
- *"Receipt URL vs embedded hash?"* — embedding one per-asset hash is misleading (receipts are per-alert). The audit link is the correct verify pointer; matches the validated sample.
