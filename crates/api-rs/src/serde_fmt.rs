//! Serialization-boundary formatters — the one place the API turns raw
//! `rust_decimal::Decimal` / `chrono::DateTime` values into clean JSON.
//!
//! Rationale: `Decimal` inherits its scale from the Postgres `NUMERIC` column
//! (`NUMERIC(30,18)`, and multiplication is scale-additive), so untouched it
//! serializes with a long tail of noise zeros (`"806135332.1103866692430900000"`).
//! And `DateTime<Utc>`/`to_rfc3339()` emit an inconsistent mix of nanosecond +
//! offset vs microsecond + `Z`. These helpers are applied via
//! `#[serde(serialize_with = ...)]` on the response structs so the fix lives in
//! ONE place and every endpoint formats identically.
//!
//! CONTRACT SAFETY (ADR — `/v1` is additive-only): every helper here is
//! value-preserving. `dec_norm` only strips trailing zeros (same number).
//! `dec_money2` rounds USD aggregates to the cent — sub-cent on a
//! hundreds-of-millions figure is definitionally noise, and price/discount
//! signal fields keep full precision via `dec_norm`. Timestamps keep the same
//! instant (still RFC3339), only the precision/zulu form is normalized. No
//! field is renamed or removed. Rounding happens ONLY at serialization — the DB
//! and all computation keep full precision.

use chrono::{DateTime, SecondsFormat, Utc};
use rust_decimal::Decimal;
use serde::Serializer;

/// Canonical wire timestamp: RFC3339, millisecond precision, `Z` suffix
/// (`2026-07-24T15:33:14.545Z`). Use at construction sites that build a
/// pre-formatted `String` timestamp (e.g. `as_of`, `generated_at`, `released_at`).
pub fn rfc3339_millis_z(t: &DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// `Decimal` → decimal string with trailing zeros stripped. Value-identical
/// (`3.582350020000000000` → `3.58235002`, `0.001810` → `0.00181`).
pub fn dec_norm<S: Serializer>(v: &Decimal, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&v.normalize().to_string())
}

/// `Option<Decimal>` variant of [`dec_norm`]. Serializes `None` as JSON `null`
/// (matching the explicit-null contract on fields without
/// `skip_serializing_if`); on fields that DO skip, `None` is skipped upstream
/// and this branch is never reached.
pub fn opt_dec_norm<S: Serializer>(v: &Option<Decimal>, s: S) -> Result<S::Ok, S::Error> {
    match v {
        Some(d) => s.serialize_str(&d.normalize().to_string()),
        None => s.serialize_none(),
    }
}

/// `Option<Decimal>` rounded to 18 decimal places (half away from zero, the
/// NUMERIC rounding Postgres applies to the NUMERIC(30,18) legs), then
/// normalized. For values read from JSON metadata (e.g. `sol_per_lst`), which
/// carry no column scale and arrived with up to 28 dp.
pub fn opt_dec_18<S: Serializer>(v: &Option<Decimal>, s: S) -> Result<S::Ok, S::Error> {
    match v {
        Some(d) => s.serialize_str(
            &d.round_dp_with_strategy(18, rust_decimal::RoundingStrategy::MidpointAwayFromZero)
                .normalize()
                .to_string(),
        ),
        None => s.serialize_none(),
    }
}

/// USD-aggregate `Decimal` → decimal string rounded to the cent, then
/// normalized so whole amounts stay clean (`1000000` not `1000000.00`).
/// For `market_cap`, `loop_exposure_usd`, `liquidatable_usd`, `collateral_usd`,
/// `debt_usd` — where sub-cent precision is noise.
pub fn dec_money2<S: Serializer>(v: &Decimal, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&v.round_dp(2).normalize().to_string())
}

/// `Option<Decimal>` variant of [`dec_money2`]. `None` → JSON `null`.
pub fn opt_dec_money2<S: Serializer>(v: &Option<Decimal>, s: S) -> Result<S::Ok, S::Error> {
    match v {
        Some(d) => s.serialize_str(&d.round_dp(2).normalize().to_string()),
        None => s.serialize_none(),
    }
}

/// `DateTime<Utc>` → canonical millisecond-`Z` RFC3339 string.
pub fn ts_millis_z<S: Serializer>(v: &DateTime<Utc>, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&rfc3339_millis_z(v))
}

/// `Option<DateTime<Utc>>` variant of [`ts_millis_z`]. `None` → JSON `null`
/// (skipped upstream on fields that set `skip_serializing_if`).
pub fn opt_ts_millis_z<S: Serializer>(v: &Option<DateTime<Utc>>, s: S) -> Result<S::Ok, S::Error> {
    match v {
        Some(t) => s.serialize_str(&rfc3339_millis_z(t)),
        None => s.serialize_none(),
    }
}

/// Round an `f64` to 8 decimal places. `serde_json` (ryu) then emits the
/// shortest round-tripping form, so `-0.011128676923076923` becomes the clean
/// `-0.01112868` on the wire.
fn round8(x: f64) -> f64 {
    (x * 1e8).round() / 1e8
}

/// `Option<Vec<f64>>` (the `series_24h` sparkline) → each sample rounded to 8dp.
/// Kills the raw-float noise (`-0.011128676923076923`) while preserving the
/// visual shape of the series.
pub fn opt_round_f64_8<S: Serializer>(v: &Option<Vec<f64>>, s: S) -> Result<S::Ok, S::Error> {
    match v {
        Some(xs) => s.collect_seq(xs.iter().map(|x| round8(*x))),
        None => s.serialize_none(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;
    use std::str::FromStr;

    #[derive(Serialize)]
    struct DecNorm(#[serde(serialize_with = "dec_norm")] Decimal);
    #[derive(Serialize)]
    struct OptDecNorm(#[serde(serialize_with = "opt_dec_norm")] Option<Decimal>);
    #[derive(Serialize)]
    struct DecMoney2(#[serde(serialize_with = "dec_money2")] Decimal);
    #[derive(Serialize)]
    struct OptMoney2(#[serde(serialize_with = "opt_dec_money2")] Option<Decimal>);
    #[derive(Serialize)]
    struct Ts(#[serde(serialize_with = "ts_millis_z")] DateTime<Utc>);
    #[derive(Serialize)]
    struct Series(#[serde(serialize_with = "opt_round_f64_8")] Option<Vec<f64>>);

    fn d(s: &str) -> Decimal {
        Decimal::from_str(s).unwrap()
    }

    #[test]
    fn dec_norm_strips_trailing_zeros_value_preserving() {
        assert_eq!(
            serde_json::to_value(DecNorm(d("3.582350020000000000"))).unwrap(),
            "3.58235002"
        );
        assert_eq!(
            serde_json::to_value(DecNorm(d("0.001810"))).unwrap(),
            "0.00181"
        );
        // Integers keep no spurious decimal point.
        assert_eq!(
            serde_json::to_value(DecNorm(d("1000000"))).unwrap(),
            "1000000"
        );
        // A negative signed discount is untouched in value.
        assert_eq!(
            serde_json::to_value(DecNorm(d("-0.007405"))).unwrap(),
            "-0.007405"
        );
    }

    #[test]
    fn opt_dec_norm_none_is_null_some_is_string() {
        assert_eq!(
            serde_json::to_value(OptDecNorm(None)).unwrap(),
            serde_json::Value::Null
        );
        assert_eq!(
            serde_json::to_value(OptDecNorm(Some(d("82.379387149534329810")))).unwrap(),
            "82.37938714953432981"
        );
    }

    #[test]
    fn dec_money2_rounds_to_cent_and_normalizes() {
        assert_eq!(
            serde_json::to_value(DecMoney2(d("806135332.1103866692430900000"))).unwrap(),
            "806135332.11"
        );
        // Whole dollars stay clean (compat with peg.rs "1000000" assertion).
        assert_eq!(
            serde_json::to_value(DecMoney2(d("1000000"))).unwrap(),
            "1000000"
        );
        assert_eq!(
            serde_json::to_value(OptMoney2(None)).unwrap(),
            serde_json::Value::Null
        );
        assert_eq!(
            serde_json::to_value(OptMoney2(Some(d("331965757.363492300000000000")))).unwrap(),
            "331965757.36"
        );
    }

    #[test]
    fn ts_is_millis_z() {
        let t: DateTime<Utc> = "2026-07-24T15:33:14.545812086+00:00".parse().unwrap();
        assert_eq!(
            serde_json::to_value(Ts(t)).unwrap(),
            "2026-07-24T15:33:14.545Z"
        );
    }

    #[test]
    fn series_rounds_to_8dp() {
        let v =
            serde_json::to_value(Series(Some(vec![-0.011128676923076923, -0.0111448175]))).unwrap();
        assert_eq!(v, serde_json::json!([-0.01112868, -0.01114482]));
        assert_eq!(
            serde_json::to_value(Series(None)).unwrap(),
            serde_json::Value::Null
        );
    }
}
