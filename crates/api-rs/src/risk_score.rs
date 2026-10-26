//! Derived 0-100 peg-risk score for the `/v1/assets` + `/v1/assets/:symbol/state`
//! responses.
//!
//! A single sortable / thresholdable number a B2B integrator (a lender or
//! insurer's risk desk, or any dashboard embedding Pegana) can branch on in one
//! line — `if risk_score >= 75 { gate_market() }` — WITHOUT replacing the
//! authoritative PEGGED / DRIFT / DEPEG / CRITICAL / BLACK_SWAN classification.
//!
//! HONESTY INVARIANTS (this is a trust product — the score must never overclaim):
//!  - **Anchored to the committed FSM `state`**, so the score NEVER disagrees
//!    with the classification: each state owns a fixed 25-point band and the
//!    score only interpolates WITHIN that band by the effective discount
//!    magnitude. A PEGGED asset can never score above 24; a CRITICAL one can
//!    never score below 75.
//!  - **`None` (serialized `null`)** when the state is UNKNOWN / absent, there is
//!    no discount, or thresholds aren't the bps-keyed shape (the CDP
//!    collateral-ratio form, e.g. hyUSD). We never fabricate a number we don't
//!    have — ADR-0019, "missing data is not confirming data."
//!  - **Deterministic + reproducible**: a pure function of already-published
//!    fields (`state`, `discount`, `class`, `thresholds`), so any consumer can
//!    recompute it from `/v1/assets`. NOT part of any receipt hash — the receipt
//!    (methodology re-derivation) is untouched; this is a presentation-layer
//!    projection of it.
//!  - **Direction-sensitive**: for `lst` / `stable_yield` a benign premium
//!    (market above NAV — legitimate yield accrual) scores ~0, matching the
//!    methodology's `is_direction_sensitive` carve-out. A symmetric class uses
//!    `|discount|`.

use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;

/// Per-committed-state score band + the discount window it interpolates over.
/// Returns `(score_lo, score_hi, disc_lo_bps, disc_hi_bps)`; `None` for UNKNOWN
/// or any unrecognized state (→ no score).
fn band_for_state(
    state: &str,
    drift: f64,
    depeg: f64,
    critical: f64,
) -> Option<(f64, f64, f64, f64)> {
    let black_swan = critical * 2.0; // methodology: black_swan band = 2× critical
    match state {
        "PEGGED" => Some((0.0, 24.0, 0.0, drift)),
        "DRIFT" => Some((25.0, 49.0, drift, depeg)),
        "DEPEG" => Some((50.0, 74.0, depeg, critical)),
        "CRITICAL" => Some((75.0, 94.0, critical, black_swan)),
        "BLACK_SWAN" => Some((95.0, 100.0, black_swan, black_swan * 2.0)),
        _ => None,
    }
}

/// Compute the derived 0-100 peg-risk score, or `None` when it cannot be stated
/// honestly. See the module docs for the invariants.
pub fn risk_score(
    state: Option<&str>,
    discount: Option<Decimal>,
    class: &str,
    thresholds: Option<&serde_json::Value>,
) -> Option<u8> {
    let state = state?;
    let discount = discount?;
    let t = thresholds?;

    // bps-keyed thresholds only. The CDP collateral-ratio form (hyUSD:
    // cr_drift/cr_depeg/…) and any malformed shape yield None — we do not invent
    // a 0-100 mapping for a scale we don't model here.
    let drift = t.get("drift_bps").and_then(serde_json::Value::as_f64)?;
    let depeg = t.get("depeg_bps").and_then(serde_json::Value::as_f64)?;
    let critical = t.get("critical_bps").and_then(serde_json::Value::as_f64)?;
    if !(drift > 0.0 && depeg >= drift && critical >= depeg) {
        return None; // malformed / non-monotonic bands
    }

    let disc = discount.to_f64()?;
    // Classes whose premium the engine treats as informational (ADR-0021:
    // lst, stable_yield, synth_lev) carve out a benign premium (market above
    // NAV): it is not risk, so it scores ~0. Same rule the engine classifies
    // with, so the score never disagrees with `risk_side`. Others score
    // |discount|.
    let direction_sensitive = pegana_common::AssetClass::from_db_str(class)
        .is_some_and(pegana_methodology::thresholds::premium_is_informational);
    let eff_bps = if direction_sensitive {
        disc.max(0.0) * 10_000.0
    } else {
        disc.abs() * 10_000.0
    };

    let (score_lo, score_hi, disc_lo, disc_hi) = band_for_state(state, drift, depeg, critical)?;
    // Interpolate within the state's band; clamp so the score stays inside the
    // band the committed state owns (never disagrees with the classification).
    let frac = if disc_hi > disc_lo {
        ((eff_bps - disc_lo) / (disc_hi - disc_lo)).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let score = (score_lo + (score_hi - score_lo) * frac).round();
    Some(score.clamp(0.0, 100.0) as u8)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;
    use serde_json::json;

    fn bands() -> serde_json::Value {
        // JLP-like: drift 200, depeg 400, critical 1500 → black_swan 3000.
        json!({ "drift_bps": 200, "depeg_bps": 400, "critical_bps": 1500 })
    }
    fn d(bps: i64) -> Option<Decimal> {
        // bps → signed fraction (100 bps = 0.01)
        Some(Decimal::from(bps) / Decimal::from(10_000))
    }

    /// A premium (negative discount) on a premium-informational class scores 0,
    /// including synth_lev (xSOL), matching the engine's PEGGED verdict.
    #[test]
    fn premium_scores_zero_on_premium_informational_classes() {
        for class in ["lst", "stable_yield", "synth_lev"] {
            assert_eq!(
                risk_score(Some("PEGGED"), d(-300), class, Some(&bands())),
                Some(0),
                "{class}"
            );
        }
        // A fiat stable's premium is still deviation.
        assert_eq!(
            risk_score(Some("PEGGED"), d(-200), "stable_fiat", Some(&bands())),
            Some(24)
        );
    }

    #[test]
    fn pegged_at_zero_is_zero() {
        assert_eq!(
            risk_score(Some("PEGGED"), d(0), "stable_fiat", Some(&bands())),
            Some(0)
        );
    }

    #[test]
    fn pegged_tops_out_at_24_and_never_exceeds_its_band() {
        // at drift edge → 24
        assert_eq!(
            risk_score(Some("PEGGED"), d(200), "stable_fiat", Some(&bands())),
            Some(24)
        );
        // a discount spike beyond drift is CLAMPED to the PEGGED band (state wins)
        assert_eq!(
            risk_score(Some("PEGGED"), d(9999), "stable_fiat", Some(&bands())),
            Some(24)
        );
    }

    #[test]
    fn state_bands_are_ordered_and_contiguous() {
        assert_eq!(
            risk_score(Some("DRIFT"), d(200), "stable_fiat", Some(&bands())),
            Some(25)
        );
        assert_eq!(
            risk_score(Some("DRIFT"), d(400), "stable_fiat", Some(&bands())),
            Some(49)
        );
        assert_eq!(
            risk_score(Some("DEPEG"), d(400), "stable_fiat", Some(&bands())),
            Some(50)
        );
        assert_eq!(
            risk_score(Some("DEPEG"), d(1500), "stable_fiat", Some(&bands())),
            Some(74)
        );
        assert_eq!(
            risk_score(Some("CRITICAL"), d(1500), "stable_fiat", Some(&bands())),
            Some(75)
        );
        assert_eq!(
            risk_score(Some("CRITICAL"), d(3000), "stable_fiat", Some(&bands())),
            Some(94)
        );
        assert_eq!(
            risk_score(Some("BLACK_SWAN"), d(3000), "stable_fiat", Some(&bands())),
            Some(95)
        );
        assert_eq!(
            risk_score(Some("BLACK_SWAN"), d(6000), "stable_fiat", Some(&bands())),
            Some(100)
        );
    }

    #[test]
    fn direction_sensitive_benign_premium_scores_zero() {
        // lst PEGGED with a large PREMIUM (market above NAV) → not risk → 0
        assert_eq!(
            risk_score(Some("PEGGED"), d(-500), "lst", Some(&bands())),
            Some(0)
        );
        // stable_yield premium likewise
        assert_eq!(
            risk_score(Some("PEGGED"), d(-2000), "stable_yield", Some(&bands())),
            Some(0)
        );
        // but a real DISCOUNT on the lst still scores
        assert_eq!(
            risk_score(Some("PEGGED"), d(200), "lst", Some(&bands())),
            Some(24)
        );
    }

    #[test]
    fn symmetric_class_uses_absolute_value() {
        // stable_fiat: a premium is just as much a break as a discount
        assert_eq!(
            risk_score(Some("PEGGED"), d(-200), "stable_fiat", Some(&bands())),
            Some(24)
        );
    }

    #[test]
    fn unknown_or_missing_inputs_yield_none() {
        assert_eq!(
            risk_score(Some("UNKNOWN"), d(100), "stable_fiat", Some(&bands())),
            None
        );
        assert_eq!(
            risk_score(None, d(100), "stable_fiat", Some(&bands())),
            None
        );
        assert_eq!(
            risk_score(Some("PEGGED"), None, "stable_fiat", Some(&bands())),
            None
        );
        assert_eq!(
            risk_score(Some("PEGGED"), d(100), "stable_fiat", None),
            None
        );
    }

    #[test]
    fn cdp_collateral_ratio_thresholds_yield_none() {
        // hyUSD-style CR-form thresholds are not bps → honest null, not a fake score
        let cr = json!({ "cr_drift": 130, "cr_depeg": 120, "cr_critical": 110 });
        assert_eq!(
            risk_score(Some("DRIFT"), d(100), "stable_cdp", Some(&cr)),
            None
        );
    }
}
