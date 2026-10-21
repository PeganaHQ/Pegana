//! Advisory, OUT-OF-HASH "amber" annotation for the single-asset detail
//! endpoints (`/v1/assets/{symbol}` + by-mint), synthesized server-side from
//! the independent Pyth oracle leg (`oracle_snapshots`). Sits BELOW the
//! existing hard Pyth-confidence gate (500bps -> UNKNOWN, methodology's
//! `PYTH_CONFIDENCE_GATE_BPS` / ADR-0032): where that gate collapses the
//! VERDICT itself, this module only annotates a tick that already survived
//! it — it never overrides `discount`/`state`/thresholds and is never a
//! receipt input.
//!
//! API-layer + additive only: `classify_oracle_degraded` is a pure function
//! over values already read off the row by `fetch_card`
//! (`routes/assets.rs`) — see its SQL for the asof-join that supplies the
//! oracle leg (same join-key pattern `/history`'s `oracle_usd` CASE already
//! uses; see that comment for the feed_id 0x-normalization rationale).

use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Advisory oracle-vs-market divergence annotation for a single asset. Never
/// a receipt input; never part of the canonical hash; purely additive on the
/// single-asset detail response. Omitted entirely (not `null`) via the
/// `Option<OracleDegraded>` field's `skip_serializing_if` on `AssetCard`.
// Clone + Deserialize so it round-trips through the shared `/v1/assets` Redis
// cache that `/v1/peg/feed` now reuses (see AssetCard).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct OracleDegraded {
    /// Machine-readable reason. Worst-first priority when multiple guards
    /// fire in the same tick: `oracle_divergence` > `oracle_confidence_wide`
    /// > `oracle_stale`.
    pub reason: String,
    /// `|market_usd - oracle_usd| / oracle_usd`, in bps. `None` when
    /// `market_usd` was absent/non-positive, or the computation overflowed.
    pub spread_bps: Option<i32>,
    /// `oracle_conf / oracle_usd`, in bps. `None` when the oracle snapshot
    /// carried no confidence interval, or the computation overflowed.
    pub conf_bps: Option<i32>,
    /// Seconds elapsed since the asof-joined oracle snapshot was published.
    /// `None` only when no oracle snapshot was found at all (in which case
    /// the whole annotation is `None` too; this field is always populated
    /// whenever `OracleDegraded` is `Some`).
    pub age_secs: Option<i64>,
}

/// Amber floor for the independent oracle leg's confidence/price ratio (bps);
/// a CONSERVATIVE starting point the founder calibrates. Any reading AT or
/// ABOVE this bound flags the asset's OWN <TICKER>/USD Pyth oracle as wide
/// (uncertain). There is deliberately NO upper bound: the engine's hard
/// confidence gate inspects the asset's NUMERAIRE feed, not this one, so a wide
/// reading here is never double-flagged by the verdict pipeline (see the
/// `conf_wide` comment in `classify_oracle_degraded`).
pub const ORACLE_DEGRADED_CONF_WARN_BPS: i32 = 100;

/// Amber floor for the `|market_usd - oracle_usd|` spread (bps); a
/// CONSERVATIVE starting point the founder calibrates. A market/oracle
/// disagreement wider than this is worth flagging even though neither hard
/// gate (Pyth confidence, NAV-sanity) has tripped.
pub const ORACLE_DEGRADED_DIVERGENCE_BPS: i32 = 75;

/// Amber floor for oracle-snapshot staleness, in seconds; a CONSERVATIVE
/// starting point the founder calibrates. Independent of the 15-minute
/// discount-snapshot freshness bound `fetch_card` already enforces on the
/// asset as a whole; this governs the ORACLE leg specifically, which can go
/// stale on its own cadence (subscribed-feed publish gaps).
pub const ORACLE_DEGRADED_STALENESS_SECS: i64 = 90;

/// `discount_snapshots.state_reason` value the engine/API already emit when
/// the hard Pyth confidence gate collapses a verdict to UNKNOWN. Mirrors
/// methodology's `STATE_REASON_PYTH_CONFIDENCE_GATE` (literal-duplicated;
/// see `PYTH_HARD_GATE_BPS`'s comment for why).
const STATE_REASON_PYTH_CONFIDENCE_GATE: &str = "pyth_confidence_gate";

const REASON_DIVERGENT: &str = "oracle_divergence";
const REASON_CONF_WIDE: &str = "oracle_confidence_wide";
const REASON_STALE: &str = "oracle_stale";

/// `|numerator / denominator| * 10_000`, rounded to the nearest bps, as an
/// `i32`. Uses ONLY checked arithmetic: a zero/overflowing division, an
/// overflowing multiply, or a result outside `i32`'s range all collapse to
/// `None` ("no signal"), never a panic. Mirrors the checked-arithmetic
/// discipline of `methodology::pyth_confidence_gate_violated` /
/// `premium_sanity_violated`, except overflow here means "can't annotate"
/// rather than "violated"; this is an advisory amber layer, not a hard gate,
/// so an implausible/overflowing read is simply withheld, not escalated.
fn checked_bps(numerator: Decimal, denominator: Decimal) -> Option<i32> {
    let ratio = numerator.checked_div(denominator)?.abs();
    let bps = ratio.checked_mul(Decimal::from(10_000u32))?;
    bps.round().to_i32()
}

/// Synthesize the advisory `oracle_degraded` annotation for a single-asset
/// detail row from the independent Pyth oracle leg. Pure + unit-testable;
/// every input is a value already read off the row in `fetch_card`; this
/// function performs no I/O and its output is NEVER a receipt input.
///
/// All guards below are REQUIRED (any one returning early means `None`; the
/// field is omitted):
/// - no independent oracle leg at all: `oracle_usd` is absent or `<= 0`. The
///   `> 0` guard mirrors the frontend's zeroed-print guard (JupUSD
///   false-CRITICAL EWMA fix, 2026-06-12); a zeroed print must not
///   fabricate a false signal;
/// - the snapshot is already hard-gated to UNKNOWN by the 500bps Pyth
///   confidence gate (`state_reason == "pyth_confidence_gate"`); amber only
///   annotates a tick that SURVIVED that gate, never doubles up on one
///   already collapsed;
/// - none of the three amber conditions actually fire.
///
/// When at least one condition fires, `reason` picks the worst first;
/// `oracle_divergence` > `oracle_confidence_wide` > `oracle_stale`; and
/// every value that was actually COMPUTED (regardless of whether it
/// individually fired) is populated, so a client badge can show full context
/// rather than only the trigger.
pub fn classify_oracle_degraded(
    market_usd: Option<Decimal>,
    oracle_usd: Option<Decimal>,
    oracle_conf: Option<Decimal>,
    oracle_age_secs: Option<i64>,
    state_reason: Option<&str>,
) -> Option<OracleDegraded> {
    // No independent oracle leg — nothing to annotate.
    let oracle_usd = oracle_usd.filter(|v| *v > Decimal::ZERO)?;

    // Already hard-gated to UNKNOWN — don't double-flag.
    if state_reason == Some(STATE_REASON_PYTH_CONFIDENCE_GATE) {
        return None;
    }

    let conf_bps = oracle_conf.and_then(|conf| checked_bps(conf, oracle_usd));
    // No upper bound. Unlike the engine's hard Pyth gate — which inspects the
    // asset's NUMERAIRE feed (e.g. USDC/USD; `pyth_feeds_for_asset` in
    // engine-rs/main.rs pushes ONLY the numeraire for a jupiter_usd asset,
    // never `a.pyth_feed_id`) — this reads the asset's OWN independent
    // <TICKER>/USD oracle leg from `oracle_snapshots`, which NO hard gate
    // bounds. So a wide reading here (even >= 500bps) is a real, UN-gated amber
    // signal worth surfacing — the whole point of this layer — never something
    // already collapsed to UNKNOWN by the verdict pipeline.
    let conf_wide = conf_bps.is_some_and(|bps| bps >= ORACLE_DEGRADED_CONF_WARN_BPS);

    let spread_bps = market_usd
        .filter(|m| *m > Decimal::ZERO)
        .and_then(|m| m.checked_sub(oracle_usd))
        .and_then(|diff| checked_bps(diff, oracle_usd));
    let divergent = spread_bps.is_some_and(|bps| bps > ORACLE_DEGRADED_DIVERGENCE_BPS);

    let stale = oracle_age_secs.is_some_and(|secs| secs > ORACLE_DEGRADED_STALENESS_SECS);

    if !(divergent || conf_wide || stale) {
        return None;
    }

    let reason = if divergent {
        REASON_DIVERGENT
    } else if conf_wide {
        REASON_CONF_WIDE
    } else {
        REASON_STALE
    };

    Some(OracleDegraded {
        reason: reason.to_string(),
        spread_bps,
        conf_bps,
        age_secs: oracle_age_secs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usd(v: i64) -> Decimal {
        Decimal::new(v, 4) // v is in 1e-4 USD units, e.g. usd(10000) == 1.0000
    }

    /// Healthy tick: a subscribed oracle leg exists, but nothing amber fires
    /// (tight confidence, tight spread, fresh snapshot) -> omitted.
    #[test]
    fn healthy_returns_none() {
        let out = classify_oracle_degraded(
            Some(usd(10000)),         // market_usd = 1.0000
            Some(usd(9999)),          // oracle_usd = 0.9999 (1bps spread)
            Some(Decimal::new(1, 4)), // conf = 0.0001 -> ~1bps
            Some(5),                  // 5s old
            None,
        );
        assert!(out.is_none(), "healthy tick must not be flagged: {out:?}");
    }

    /// Divergence fires strictly above 75bps, and does NOT fire at exactly
    /// 75bps (the boundary belongs to "healthy").
    #[test]
    fn divergence_fires_above_threshold_not_at_boundary() {
        // oracle_usd = 1.0000, market_usd off by exactly 76bps -> fires.
        let fires = classify_oracle_degraded(
            Some(Decimal::new(10076, 4)), // 1.0076
            Some(usd(10000)),
            None,
            None,
            None,
        );
        let card = fires.expect("76bps spread must fire divergence");
        assert_eq!(card.reason, "oracle_divergence");
        assert_eq!(card.spread_bps, Some(76));

        // Exactly 75bps -> must NOT fire (spec: `spread_bps > 75`).
        let boundary = classify_oracle_degraded(
            Some(Decimal::new(10075, 4)), // 1.0075
            Some(usd(10000)),
            None,
            None,
            None,
        );
        assert!(
            boundary.is_none(),
            "exactly 75bps must NOT fire divergence: {boundary:?}"
        );
    }

    /// Confidence-wide fires AT exactly 100bps (the amber floor is
    /// inclusive), and does NOT fire at 99bps.
    #[test]
    fn conf_wide_fires_at_threshold_not_just_below() {
        // conf/oracle = 100bps exactly -> fires.
        let fires = classify_oracle_degraded(
            None,
            Some(usd(10000)),           // oracle_usd = 1.0000
            Some(Decimal::new(100, 4)), // conf = 0.0100 -> 100bps
            None,
            None,
        );
        let card = fires.expect("exactly 100bps confidence must fire");
        assert_eq!(card.reason, "oracle_confidence_wide");
        assert_eq!(card.conf_bps, Some(100));

        // 99bps -> must NOT fire.
        let below = classify_oracle_degraded(
            None,
            Some(usd(10000)),
            Some(Decimal::new(99, 4)), // 0.0099 -> 99bps
            None,
            None,
        );
        assert!(below.is_none(), "99bps confidence must NOT fire: {below:?}");
    }

    /// The asset's OWN oracle leg is NOT bounded by the engine's hard Pyth gate
    /// (that gate inspects the NUMERAIRE feed; see `conf_wide`'s comment), so
    /// there is deliberately no upper bound: a reading at OR ABOVE 500bps on
    /// this feed is un-gated and MUST still surface as amber. Regression guard
    /// for the `[100, 500)` bug the review caught; the worst case (a very wide
    /// independent oracle) was being silently dropped.
    #[test]
    fn conf_at_or_above_500_still_fires_amber() {
        for bps in [500i64, 800, 2500] {
            let out = classify_oracle_degraded(
                None,
                Some(usd(10000)),
                Some(Decimal::new(bps, 4)), // e.g. 0.0500 -> 500bps
                None,
                None,
            );
            let card = out.unwrap_or_else(|| panic!("{bps}bps oracle conf must fire amber"));
            assert_eq!(card.reason, "oracle_confidence_wide");
            assert_eq!(card.conf_bps, Some(bps as i32));
        }
    }

    /// Staleness fires strictly above 90s, and does NOT fire at exactly 90s.
    #[test]
    fn staleness_fires_above_threshold_not_at_boundary() {
        let fires = classify_oracle_degraded(None, Some(usd(10000)), None, Some(91), None);
        let card = fires.expect("91s age must fire staleness");
        assert_eq!(card.reason, "oracle_stale");
        assert_eq!(card.age_secs, Some(91));

        let boundary = classify_oracle_degraded(None, Some(usd(10000)), None, Some(90), None);
        assert!(
            boundary.is_none(),
            "exactly 90s must NOT fire staleness: {boundary:?}"
        );
    }

    /// The `oracle_usd > 0` guard: a zeroed or negative oracle print must
    /// never fabricate a signal, even when every other input looks alarming.
    #[test]
    fn oracle_usd_zero_or_negative_returns_none() {
        let zero = classify_oracle_degraded(
            Some(usd(10000)),
            Some(Decimal::ZERO),
            Some(Decimal::new(1000, 4)),
            Some(9_999),
            None,
        );
        assert!(
            zero.is_none(),
            "zeroed oracle_usd must yield None: {zero:?}"
        );

        let negative = classify_oracle_degraded(
            Some(usd(10000)),
            Some(Decimal::new(-1, 4)),
            Some(Decimal::new(1000, 4)),
            Some(9_999),
            None,
        );
        assert!(
            negative.is_none(),
            "negative oracle_usd must yield None: {negative:?}"
        );

        let absent = classify_oracle_degraded(
            Some(usd(10000)),
            None,
            Some(Decimal::new(1000, 4)),
            Some(9_999),
            None,
        );
        assert!(
            absent.is_none(),
            "absent oracle_usd must yield None: {absent:?}"
        );
    }

    /// The hard-gate skip: when `state_reason` already reads
    /// `"pyth_confidence_gate"`, the amber layer must stay silent even in the
    /// presence of an extreme divergence; the verdict is already UNKNOWN,
    /// re-flagging it would be noise, not new information.
    #[test]
    fn pyth_confidence_gate_state_reason_is_skipped() {
        let out = classify_oracle_degraded(
            Some(Decimal::new(20000, 4)), // 2.0000 — huge divergence
            Some(usd(10000)),
            Some(Decimal::new(600, 4)), // 600bps — way past the hard gate too
            Some(999_999),              // very stale
            Some("pyth_confidence_gate"),
        );
        assert!(
            out.is_none(),
            "pyth_confidence_gate state_reason must suppress the amber layer: {out:?}"
        );
    }

    /// Multiple-fire precedence: when divergence, confidence-wide, AND
    /// staleness all fire in the same tick, `reason` picks divergence first,
    /// but every computed value (not just the trigger) is still populated so
    /// the badge can show full context.
    #[test]
    fn multiple_fire_picks_divergence_first_with_full_context() {
        let out = classify_oracle_degraded(
            Some(Decimal::new(10200, 4)), // 1.0200 -> 200bps spread (divergent)
            Some(usd(10000)),             // oracle_usd = 1.0000
            Some(Decimal::new(150, 4)),   // 150bps confidence (amber, not gated)
            Some(200),                    // stale
            None,
        )
        .expect("all three conditions firing must still produce Some");
        assert_eq!(out.reason, "oracle_divergence", "divergence wins priority");
        assert_eq!(out.spread_bps, Some(200));
        assert_eq!(out.conf_bps, Some(150));
        assert_eq!(out.age_secs, Some(200));
    }

    /// Overflow in the checked arithmetic must collapse to "no signal"
    /// (`None`), never panic. `market_usd` here is chosen so
    /// `(market_usd - oracle_usd) * 10_000` overflows `Decimal`'s range,
    /// which must fail the `spread_bps` computation cleanly; and with no
    /// other input present, the whole result is `None`.
    #[test]
    fn overflow_collapses_to_none_without_panic() {
        let out = classify_oracle_degraded(
            Some(Decimal::MAX),
            Some(Decimal::new(1, 0)), // oracle_usd = 1
            None,
            None,
            None,
        );
        assert!(
            out.is_none(),
            "an overflowing spread computation must yield None, not panic or a bogus signal: {out:?}"
        );
    }
}
