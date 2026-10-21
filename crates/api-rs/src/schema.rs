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
    /// Startup sentinel; emitted before the first discount snapshot exists, or
    /// when every input feed is too stale/degraded to compute a discount.
    UNKNOWN,
}

/// Pyth oracle confidence bucket. Mirrors `pyth_confidence_label`. Scopes the
/// PRICE-ORACLE confidence interval only (conf/price ratio); NOT market-quote
/// or route-depth reliability.
#[derive(ToSchema)]
#[allow(non_camel_case_types, dead_code)]
pub enum Confidence {
    high,
    medium,
    low,
    /// A missing / stale / zero feed; confidence could not be computed. Ranks
    /// strictest, so a partially-degraded multi-feed asset collapses here.
    unknown,
}

/// Calibration status of an asset (and of an alert that asset emitted).
///
/// - `provisional`: a "beta" asset: released and alerting publicly, but its
///   thresholds are not yet validated over a full post-launch calibration
///   window. Equivalent to `monitoring_only=true`. Read its alerts as
///   experimental.
/// - `calibrated`: a fully calibrated asset that counts in the launch
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
/// - `"USD"`: the asset targets exactly $1 (fiat-backed, RWA, delta-neutral,
///   and CDP stablecoins). A discount from $1 IS the risk signal.
///
/// - `"FX"`: the asset targets a fixed non-USD fiat exchange rate (e.g.
///   EURC→EUR, BRZ→BRL). Read `peg_target` for the specific currency. A
///   discount from the FX rate IS the risk signal.
///
/// - `"NAV"`: the asset's fair value is its intrinsic redemption/net-asset
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
    /// Fixed $1 target; fiat-backed, RWA, delta-neutral, CDP stablecoins.
    USD,
    /// Fixed non-USD fiat exchange-rate peg (e.g. EURC→EUR, BRZ→BRL).
    /// Read `peg_target` for the specific currency.
    FX,
    /// Intrinsic redemption/net-asset value; LSTs, yield-bearing stables,
    /// synthetic leverage. Fair value is NOT pegged to a fixed fiat rate.
    NAV,
}

/// Which direction of the signed `discount` can move this asset's published
/// `state`.
///
/// - `"below"`: only a discount (market BELOW the peg/anchor) is a risk
///   signal. A premium never escalates the state. This covers USD and FX
///   anchors, and also every NAV class today (LSTs, yield-bearing stables,
///   synthetic leverage): for those the engine treats a premium as
///   informational and classifies it PEGGED (ADR-0021), so a large negative
///   `discount` on them is NOT a missed alert. An implausibly large premium on
///   an LST or yield stable is reported as `UNKNOWN` (`state_reason:
///   premium_sanity`), not as a depeg.
/// - `"either"`: both a discount and a premium can escalate the state.
///   Reserved for a NAV-anchored class without the premium carve-out; no
///   tracked class uses it today.
#[derive(ToSchema)]
#[allow(non_camel_case_types, dead_code)]
pub enum RiskSide {
    /// Only a discount escalates the state.
    below,
    /// Both a discount and a premium escalate the state.
    either,
}

/// Map an `anchor` value (`"USD"`, `"FX"`, or `"NAV"`) to a `risk_side`
/// without class information. Prefer [`risk_side_for_class`], which knows
/// about the ADR-0021 premium carve-out; this is kept for callers that only
/// hold an anchor.
///
/// On an unexpected anchor string (should not occur given the closed set) this
/// returns `"below"`; the conservative default that avoids implying a premium
/// is safe when we don't know the anchor semantics.
pub fn risk_side_for_anchor(anchor: &str) -> &'static str {
    match anchor {
        "NAV" => "either",
        // "USD", "FX", and any unrecognised future value → "below".
        _ => "below",
    }
}

/// The consumer-facing `risk_side` for an asset class, derived from the SAME
/// rule the engine classifies with: when
/// `pegana_methodology::thresholds::premium_is_informational(class)` holds, a
/// premium is classified PEGGED, so only the discount side is a risk signal
/// (`"below"`). Otherwise the anchor decides (`NAV` → `"either"`). An unknown
/// class string falls back to the anchor mapping.
pub fn risk_side_for_class(class: &str) -> &'static str {
    match AssetClass::from_db_str(class) {
        Some(ac) if pegana_methodology::thresholds::premium_is_informational(ac) => "below",
        _ => risk_side_for_anchor(anchor_for_class(class)),
    }
}

/// Map `asset_class` (as the text string stored in and returned by Postgres)
/// to the consumer-facing `anchor` value (`"USD"`, `"FX"`, or `"NAV"`).
///
/// Delegates to `AssetClass::anchor()`; the canonical, compile-time-
/// exhaustive mapping in `common-verify`; so this function is the ONLY place
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

/// `asset_class` values served on the public peg surface. `synth_lev` (e.g.
/// xSOL) is tracked internally but has no peg, so every public route, the
/// feed, stats and the WebSocket stream exclude it.
pub const PUBLIC_CLASSES: [&str; 7] = [
    "lst",
    "stable_fiat",
    "stable_cdp",
    "stable_rwa",
    "stable_dn",
    "stable_fx",
    "stable_yield",
];

/// Classes tracked but never served publicly.
pub const NON_PUBLIC_CLASSES: [&str; 1] = ["synth_lev"];

/// True when assets of `class` appear on the public surface.
pub fn is_public_class(class: &str) -> bool {
    !NON_PUBLIC_CLASSES.contains(&class)
}

/// `peg_target` values (the Postgres enum).
pub const PEG_TARGETS: [&str; 4] = ["SOL", "USD", "BRL", "EUR"];

#[cfg(test)]
mod class_tests {
    use super::*;
    use std::collections::HashSet;

    /// Classify every `AssetClass` variant, and name the next one so the walk
    /// below visits them all. The `match` is exhaustive: adding a variant is a
    /// compile error here until it is classified and chained in.
    fn classify(c: AssetClass) -> (bool, Option<AssetClass>) {
        use AssetClass::*;
        match c {
            Lst => (true, Some(StableFiat)),
            StableFiat => (true, Some(StableCdp)),
            StableCdp => (true, Some(StableRwa)),
            StableRwa => (true, Some(StableDn)),
            StableDn => (true, Some(StableFx)),
            StableFx => (true, Some(StableYield)),
            StableYield => (true, Some(SynthLev)),
            SynthLev => (false, None),
        }
    }

    /// The two lists partition the `AssetClass` enum exactly, so a new class
    /// cannot silently fall out of `?class=` validation.
    #[test]
    fn public_and_non_public_classes_cover_every_asset_class() {
        let mut seen = HashSet::new();
        let mut cur = Some(AssetClass::Lst);
        while let Some(c) = cur {
            assert!(seen.insert(c), "{c:?} visited twice: fix the chain");
            let (public, next) = classify(c);
            let db = serde_json::to_value(c).unwrap();
            let db = db.as_str().unwrap();
            assert_eq!(AssetClass::from_db_str(db), Some(c));
            assert_eq!(
                PUBLIC_CLASSES.contains(&db),
                public,
                "{db} PUBLIC_CLASSES membership"
            );
            assert_eq!(
                NON_PUBLIC_CLASSES.contains(&db),
                !public,
                "{db} NON_PUBLIC_CLASSES membership"
            );
            cur = next;
        }
        for c in PUBLIC_CLASSES.iter().chain(NON_PUBLIC_CLASSES.iter()) {
            let v = AssetClass::from_db_str(c).unwrap_or_else(|| panic!("{c} is an AssetClass"));
            assert!(seen.contains(&v), "{c} not reached by the classify walk");
        }
        assert_eq!(seen.len(), PUBLIC_CLASSES.len() + NON_PUBLIC_CLASSES.len());
        assert!(!is_public_class("synth_lev"));
        assert!(is_public_class("lst"));
    }
}
