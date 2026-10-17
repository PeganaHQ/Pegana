# ADR-0042 — Normalize API output formatting at the serialization boundary (value-preserving)

- **Status:** Accepted (2026-07-24). On `landing/v2-port`, **NOT deployed**.
- **Scope:** the JSON *representation* of decimal and timestamp fields on every `api-rs` response
  (the public data plane, the authenticated `/v1/me`·`/v1/auth`·webhook-meta surfaces, and the
  `/v1/audit*` receipt envelope). Introduces `crates/api-rs/src/serde_fmt.rs`.
- **Does NOT change** any field name, JSON type (string stays string, number stays number), the
  `/v1` shape, or any receipt-hash input.

## Context

Response decimals are `rust_decimal::Decimal` (serialized as strings, correctly). But the scale is
inherited from the Postgres `NUMERIC(30,18)` columns and `NUMERIC` multiplication is scale-additive,
so untouched they serialize with a long tail of noise zeros —
`"806135332.1103866692430900000"`, `"3.582350020000000000"`. Timestamps came from chrono's default
serde or `.to_rfc3339()`, producing an inconsistent mix of nanosecond / microsecond precision and
`+00:00` / `Z` forms across endpoints. `series_24h` was raw `f64`. There was **no formatting layer**
between the raw DB value and the wire — every value passed straight through `serde_json`.

(The apparent `<5` "escaping" in `positions_affected` was **not** an API bug — the raw feed
returns `"<5"`; the escape came from JSON embedded in an HTML doc. Confirmed 1:1; nothing to fix.)

The `/v1` read surface is a documented **additive-only** contract (`docs-site/guides/rest-api.mdx`
"Stability contract"), and an external partner (tokens.xyz) plus public embed widgets consume it. A
full structural redesign (uniform envelope, consistent field naming, dropping redundant
`methodology`) would be **breaking** and is therefore out of scope here.

## Decision

Add a single serialization-boundary layer — `serde_fmt.rs` helpers applied via
`#[serde(serialize_with = …)]` on the response structs (and at the `serde_json::json!` sites the
audit endpoints build by hand). Rounding happens **only at serialization**; the DB and all
computation keep full precision.

- **`dec_norm`** — strip trailing zeros only. **Lossless.** For price/ratio/signal fields
  (`discount`, `intrinsic_usd`, `market_usd`, `sol_per_lst`, `worst_abs_24h`, `jitter_bps_24h`,
  `circulating_supply`, history legs).
- **`dec_money2`** — `round_dp(2).normalize()`. For **USD aggregate** fields (`market_cap`,
  `loop_exposure_usd`, `liquidatable_usd`, `collateral_usd`, `collateral_lev_usd`, `debt_usd`)
  where sub-cent precision on a hundreds-of-millions figure is definitionally noise.
- **`ts_millis_z` / `rfc3339_millis_z`** — RFC3339 UTC, millisecond precision, `Z` suffix. Same
  instant, one form, everywhere.
- **`opt_round_f64_8`** — round the `series_24h` sparkline to 8 decimals.

This is **value-preserving**: every numeric value and instant is identical to before; only the
string representation changes. It is therefore **within the additive `/v1` contract** — a consumer
that parses (decimal library / `Date.parse`) is unaffected; only an exact byte-string comparison
would notice, and that was never a supported way to read the API.

**Receipt-hash boundary (audit).** The audit *envelope* timestamps are normalized, but the receipt
integrity path is untouched: `receipt_sha256` is computed over frozen DB inputs
(`canonical_receipt_hash`), the CLI re-hashes from the opaque `replay_artifact` JSONB, and the
on-chain SPL Memo commits no timestamp. `evidence.inputs_frozen`, `evidence.computed`, and
`replay_artifact` are passed through as opaque `serde_json::Value` and are **never** routed through
these helpers. Audit *decimals* are left raw (exact) — that surface is forensic, and its
detection-time captures are distinct values from the live feed, so normalizing them buys no
cross-endpoint consistency.

## Alternatives considered

- **(a) Ship a clean `/v2`** with a uniform envelope, consistent `*_at` naming, and no redundancy.
  This is the contract-honoring path for the *structural* cleanup and remains the plan for that —
  **deferred**, not rejected. It doesn't address the decimal/timestamp noise any faster than this
  value-preserving pass does, and forks the surface.
- **(b) Leave the raw scale.** Rejected — it is the actual "ugly output" complaint, and the noise
  zeros make the API read as unfinished.
- **(c) Round everything, including prices.** Rejected — the discount/price fields ARE the peg
  signal; rounding them would drop information. Hence `dec_norm` (lossless) for signal fields and
  `dec_money2` only for size/context aggregates.

## Consequences

- Output is clean and **consistent across every endpoint** (the previous 18/19/20-dp `market_cap`
  disagreement between `/v1/assets` and `/v1/peg/feed` is gone — both now cent-rounded identically).
- **No consumer breaks** (validated exhaustively: MCP tools use `z.string()`, the web reads via
  `parseFloat`/`Number`/`Date.parse` with no boundary validation, no other crate imports the
  structs, the Redis cache round-trip deserializes the still-valid strings, and no test pins an
  exact decimal/timestamp of a changed field).
- The structural redesign (envelope, field naming, redundancy) is explicitly **deferred to `/v2`**;
  `/v1` stays frozen in shape.

## Surfaces changed (2026-07-24)

`crates/api-rs/src/serde_fmt.rs` (new); `routes/peg.rs`, `routes/assets.rs`, `routes/alerts.rs`,
`routes/methodology.rs`, `routes/me.rs`, `routes/auth.rs`, `routes/webhooks.rs`, `routes/health.rs`
(apply helpers); `routes/audit.rs` (normalize envelope timestamps at the `json!` sites, leaving the
hash preimage untouched); `openapi.rs` (`info.description` conventions sentence); `main.rs` (module
registration). Docs: `docs-site/changelog.mdx`, `docs-site/guides/rest-api.mdx` (new **Response
format** section).
