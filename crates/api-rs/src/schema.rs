//! Doc-only OpenAPI schema types.
//!
//! These enums never appear in any handler's runtime type — response fields
//! stay `String` / `Option<String>` on the wire (the values arrive from
//! Postgres as text and are passed through verbatim). They are referenced
//! purely via `#[schema(value_type = ...)]` so `/openapi.json` advertises the
//! CLOSED set of values a typed client can model and branch on, instead of an
//! opaque `string` (Gecko API report 2026-06-10).
//!
//! Because the override is doc-only it cannot reject an out-of-set value at
//! runtime — it only documents the contract. Keep these in lockstep with the
//! engine's `PegState` (`crates/engine-rs/src/state.rs`, mirrored by the
//! `peg_state` Postgres enum) and `pyth_confidence_label`.

use pegana_common::AssetClass;
use utoipa::ToSchema;

/// Class-aware peg state. Mirrors the engine `PegState` enum and the
/// `peg_state` Postgres enum. Used for `state`, `from_state`, and `to_state`
/// fields across the API.
///
/// The state is CLASS-AWARE: an LST reading a −1.4% discount (normal unstaking
/// spread) is `PEGGED`, while a fiat stable at far less would be `DRIFT`. Trust
/// this value directly rather than imposing a naive discount cut.
// Variant identifiers are emitted VERBATIM as the OpenAPI enum values, so they
// must stay UPPER_SNAKE to match the wire contract — renaming to CamelCase
// (what these lints want) would corrupt the documented values.
#[derive(ToSchema)]
#[allow(non_camel_case_types, dead_code, clippy::upper_case_acronyms)]
pub enum PegState {
    PEGGED,
    DRIFT,
    DEPEG,
    CRITICAL,
    BLACK_SWAN,
    /// Startup sentinel — emitted before the first discount snapshot exists, or
    /// when every input feed is too stale/degraded to compute a discount.
    UNKNOWN,
}

/// Pyth oracle confidence bucket. Mirrors `pyth_confidence_label`. Scopes the
/// PRICE-ORACLE confidence interval only (conf/price ratio) — NOT market-quote
/// or route-depth reliability.
#[derive(ToSchema)]
#[allow(non_camel_case_types, dead_code)]
pub enum Confidence {
    high,
    medium,
    low,
    /// A missing / stale / zero feed — confidence could not be computed. Ranks
    /// strictest, so a partially-degraded multi-feed asset collapses here.
    unknown,
}

/// Calibration status of an asset (and of an alert that asset emitted).
///
/// - `provisional` — a "beta" asset: released and alerting publicly, but its
///   thresholds are not yet validated over a full post-launch calibration
///   window. Equivalent to `monitoring_only=true`. Read its alerts as
///   experimental.
/// - `calibrated` — a fully calibrated asset that counts in the launch
///   denominator.
///
/// This is the SAME vocabulary the dispatcher emits on the webhook canonical
/// event (`"calibration":"provisional"|"calibrated"`), so a machine consumer
/// reading both the webhook fan-out and the REST read surfaces sees one word
/// for the concept instead of `calibration` there and `monitoring_only` here.
#[derive(ToSchema)]
#[allow(non_camel_case_types, dead_code)]
pub enum Calibration {
    provisional,
    calibrated,
}

/// Map the internal `monitoring_only` flag to the consumer-facing
/// `calibration` label. Kept in lockstep with the dispatcher's webhook
/// canonical mapping (`crates/dispatcher-rs/src/main.rs`, the
/// `"calibration": if beta { "provisional" } else { "calibrated" }` line).
pub fn calibration_label(monitoring_only: bool) -> &'static str {
    if monitoring_only {
        "provisional"
    } else {
        "calibrated"
    }
}

/// Peg anchor tells a consumer how to interpret the asset's fair value WITHOUT
/// knowing Pegana's internal taxonomy:
///
/// - `"USD"` — the asset targets exactly $1 (fiat-backed, RWA, delta-neutral,
///   and CDP stablecoins). A discount from $1 IS the risk signal.
///
/// - `"FX"` — the asset targets a fixed non-USD fiat exchange rate (e.g.
///   EURC→EUR, BRZ→BRL). Read `peg_target` for the specific currency. A
///   discount from the FX rate IS the risk signal.
///
/// - `"NAV"` — the asset's fair value is its intrinsic redemption/net-asset
///   value, which is NOT a fixed fiat rate (LSTs, yield-bearing stables,
///   synthetic leverage). The discount is relative to NAV, and NAV itself
///   moves.
///
/// IMPORTANT: derived from `class`, NOT from `peg_target`. A yield-bearing
/// stable can have `peg_target = "USD"` yet `anchor = "NAV"` because its
/// price legitimately accrues above $1 over time.
#[derive(ToSchema)]
#[allow(non_camel_case_types, dead_code, clippy::upper_case_acronyms)]
pub enum Anchor {
    /// Fixed $1 target — fiat-backed, RWA, delta-neutral, CDP stablecoins.
    USD,
    /// Fixed non-USD fiat exchange-rate peg (e.g. EURC→EUR, BRZ→BRL).
    /// Read `peg_target` for the specific currency.
    FX,
    /// Intrinsic redemption/net-asset value — LSTs, yield-bearing stables,
    /// synthetic leverage. Fair value is NOT pegged to a fixed fiat rate.
    NAV,
}

/// Which direction of the signed `discount` is the risk signal for this
/// asset's anchor type.
///
/// - `"below"` — a discount BELOW the peg/anchor is the risk (USD and FX
///   anchors: the asset is worth less than the target, which is bad).
/// - `"either"` — BOTH a discount and a premium are meaningful risk signals
///   (NAV anchors: LSTs, yield-bearing stables, synthetic leverage — the
///   intrinsic value moves, so deviation in either direction from NAV signals
///   mispricing or liquidity stress).
#[derive(ToSchema)]
#[allow(non_camel_case_types, dead_code)]
pub enum RiskSide {
    /// A discount from peg is the risk. USD and FX anchors.
    below,
    /// Both discount and premium are meaningful. NAV anchors.
    either,
}

/// Map an `anchor` value (`"USD"`, `"FX"`, or `"NAV"`) to the consumer-facing
/// `risk_side` value (`"below"` or `"either"`).
///
/// `"below"` for USD/FX anchors — a discount from the fixed target IS the
/// risk signal. `"either"` for NAV anchors — NAV itself moves, so both a
/// discount and a premium can signal mispricing or liquidity stress.
///
/// On an unexpected anchor string (should not occur given the closed set) this
/// returns `"below"` — the conservative default that avoids implying a premium
/// is safe when we don't know the anchor semantics.
pub fn risk_side_for_anchor(anchor: &str) -> &'static str {
    match anchor {
        "NAV" => "either",
        // "USD", "FX", and any unrecognised future value → "below".
        _ => "below",
    }
}

/// Map `asset_class` (as the text string stored in and returned by Postgres)
/// to the consumer-facing `anchor` value (`"USD"`, `"FX"`, or `"NAV"`).
///
/// Delegates to `AssetClass::anchor()` — the canonical, compile-time-
/// exhaustive mapping in `common-verify` — so this function is the ONLY place
/// that bridges the stringly-typed Postgres text to the typed enum.  On a
/// successful parse the enum's exhaustive `match` handles the mapping; on an
/// unknown/future class string the conservative `"NAV"` fallback fires here
/// (not inside the exhaustive method, which must stay wildcard-free).
///
/// DERIVE FROM `class`, NOT FROM `peg_target`. See `Anchor` for the rationale.
pub fn anchor_for_class(class: &str) -> &'static str {
    match AssetClass::from_db_str(class) {
        Some(ac) => ac.anchor(),
        // Unknown/unrecognised class — conservative fallback.  A consumer that
        // treats an unknown class as NAV (don't assume $1) is safer than one
        // that falsely assumes USD (fixed $1 target).  In practice this branch
        // should never fire: the Postgres `asset_class` enum is migrated in
        // lockstep with `AssetClass`.
        None => "NAV",
    }
}
