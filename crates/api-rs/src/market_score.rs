//! Derived 0-100 **market-depth** score for the `/v1/assets` responses.
//!
//! Answers one question and only one: *how executable is this asset's market
//! price?* A deep, actively-traded, widely-held market means a quoted price you
//! can actually transact against; a $143-liquidity pool with 35 holders means
//! the quote is decorative. This is the signal that replaces the hardcoded
//! `Set(["USDC","USDT","jitoSOL","mSOL","JupSOL"])` the web `SafetyGrade`
//! previously used for its liquidity dimension.
//!
//! **THIS IS NOT A PEG SCORE.** `risk_score.rs` owns peg risk and is anchored to
//! the committed FSM state. This one never touches `discount`/`state`/thresholds
//! and is computed purely from the size/context columns tokens.xyz supplies
//! (migration 0075). A deeply liquid asset trading 3% below NAV scores 100 here
//! and DEPEG there — that is the correct, intended disagreement, and it is
//! precisely the hole in tokens.xyz's own model that Pegana exists to fill.
//!
//! HONESTY INVARIANTS (mirrors `risk_score.rs` — this is a trust product):
//!  - **`None` (serialized `null`)** whenever there is not enough data to state
//!    a number. `insufficient_reason` then says which input was missing. We
//!    never fabricate a score (ADR-0019, "missing data is not confirming data").
//!  - **Caps only ever pull the score DOWN**, never up — so a single
//!    disqualifying fact (a dead pool) cannot be averaged away by two healthy
//!    ones. Adapted from `computeMarketScore` in solana-foundation/tokens (MIT).
//!  - **Deterministic + reproducible**: a pure function of already-published
//!    fields, recomputable by any consumer from `/v1/assets`. NOT part of any
//!    receipt hash — a presentation-layer projection, exactly like `risk_score`.
//!
//! WHAT WAS DELIBERATELY NOT PORTED from tokens.xyz's version: their
//! "borderline signals" mechanism (4+ soft flags → cap 69) and their launch-era
//! caps (`very-new-token < 1 day`, `ghost-token < 20 holders`, `Trusted
//! Launch`). Those are tuned to detect memecoin rugs. Against Pegana's universe
//! of 69 blue-chip LSTs and stablecoins they would essentially never fire, so
//! porting them would be cargo-culting rather than engineering. The thresholds
//! below were instead set against the real observed distribution (measured
//! across all 62 covered assets on 2026-08-10: liquidity spanned $143 to $785M,
//! holders 33 to 7.9M, 24h volume $0 to $1.03B).
//!
//! ⚠️ These constants are a v1 starting point, in the same spirit as
//! `oracle_degraded.rs`'s bands: recalibrate once a few weeks of
//! `liquidity_observations` history exist. The raw inputs are all persisted, so
//! any revision can be backtested against real history.

use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
// `Deserialize` is required because `AssetCard` round-trips through the Redis
// list cache — the whole card is serialized in and back out again.
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A threshold curve point: at `value`, the component scores `score`.
struct Point {
    value: f64,
    score: f64,
}

/// Piecewise-linear interpolation over an ASCENDING threshold curve.
/// Below the first point scores the first point; above the last scores the last.
fn interpolate(value: f64, points: &[Point]) -> f64 {
    let Some(first) = points.first() else {
        return 0.0;
    };
    let last = points.last().unwrap_or(first);
    if value <= first.value {
        return first.score;
    }
    if value >= last.value {
        return last.score;
    }
    for pair in points.windows(2) {
        let (lo, hi) = (&pair[0], &pair[1]);
        if value < lo.value || value > hi.value {
            continue;
        }
        let span = hi.value - lo.value;
        if span <= 0.0 {
            return lo.score;
        }
        let frac = (value - lo.value) / span;
        return lo.score + frac * (hi.score - lo.score);
    }
    last.score
}

/// USD liquidity. $1M is the point a mid-size exit stops moving the price much;
/// $100M is the jitoSOL/BNSOL/USDC tier.
const LIQUIDITY_CURVE: &[Point] = &[
    Point {
        value: 0.0,
        score: 0.0,
    },
    Point {
        value: 50_000.0,
        score: 20.0,
    },
    Point {
        value: 250_000.0,
        score: 40.0,
    },
    Point {
        value: 1_000_000.0,
        score: 60.0,
    },
    Point {
        value: 10_000_000.0,
        score: 80.0,
    },
    Point {
        value: 100_000_000.0,
        score: 100.0,
    },
];

/// 24h USD volume. Distinguishes a deep-but-dormant pool (large TVL, no trades;
/// several LSTs look exactly like this) from a genuinely traded market.
const VOLUME_CURVE: &[Point] = &[
    Point {
        value: 0.0,
        score: 0.0,
    },
    Point {
        value: 5_000.0,
        score: 20.0,
    },
    Point {
        value: 50_000.0,
        score: 40.0,
    },
    Point {
        value: 500_000.0,
        score: 60.0,
    },
    Point {
        value: 5_000_000.0,
        score: 80.0,
    },
    Point {
        value: 50_000_000.0,
        score: 100.0,
    },
];

/// Unique holders; an adoption/distribution proxy. Thresholds sit far above
/// tokens.xyz's memecoin-oriented ones (they top out at 5k; USDC has 7.9M).
const HOLDER_CURVE: &[Point] = &[
    Point {
        value: 0.0,
        score: 0.0,
    },
    Point {
        value: 250.0,
        score: 20.0,
    },
    Point {
        value: 1_000.0,
        score: 40.0,
    },
    Point {
        value: 10_000.0,
        score: 60.0,
    },
    Point {
        value: 100_000.0,
        score: 80.0,
    },
    Point {
        value: 1_000_000.0,
        score: 100.0,
    },
];

/// Liquidity dominates: it is the only component that directly bounds exit size.
const WEIGHT_LIQUIDITY: f64 = 50.0;
const WEIGHT_VOLUME: f64 = 30.0;
const WEIGHT_HOLDERS: f64 = 20.0;

/// A hard fact that CAPS the score, no matter how the weighted average landed.
struct Cap {
    max: f64,
    reason: String,
}

/// Per-component detail, so the UI can explain the number instead of asserting it.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct MarketDepthComponents {
    /// 0-100 from `liquidity_usd`. `null` when unobserved.
    pub liquidity: Option<u8>,
    /// 0-100 from `volume_24h_usd`. `null` when unobserved.
    pub volume: Option<u8>,
    /// 0-100 from `holder_count`. `null` when unobserved.
    pub holders: Option<u8>,
}

/// Derived market-depth annotation attached to an `AssetCard`.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct MarketDepth {
    /// 0-100, higher = more executable market. `null` when the inputs are too
    /// sparse to state a number honestly; read `insufficient_reason` then.
    pub score: Option<u8>,
    /// Which hard facts capped the score, if any. Empty when nothing capped it.
    pub caps: Vec<String>,
    /// Why `score` is `null`. `None` whenever `score` is `Some`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insufficient_reason: Option<String>,
    pub components: MarketDepthComponents,
}

/// Inputs, all optional because every one of them can legitimately be missing.
#[derive(Debug, Clone, Copy, Default)]
pub struct MarketDepthInput {
    pub liquidity_usd: Option<Decimal>,
    pub volume_24h_usd: Option<Decimal>,
    pub holder_count: Option<i64>,
}

fn to_f64(d: Option<Decimal>) -> Option<f64> {
    d.and_then(|v| v.to_f64()).filter(|v| v.is_finite())
}

fn component(value: Option<f64>, curve: &[Point]) -> Option<f64> {
    value.map(|v| interpolate(v, curve))
}

/// Compute the market-depth score, or explain why it cannot be stated.
pub fn market_depth(input: MarketDepthInput) -> MarketDepth {
    let liq = to_f64(input.liquidity_usd);
    let vol = to_f64(input.volume_24h_usd);
    let holders = input.holder_count.filter(|h| *h > 0).map(|h| h as f64);

    let liq_score = component(liq, LIQUIDITY_CURVE);
    let vol_score = component(vol, VOLUME_CURVE);
    let holder_score = component(holders, HOLDER_CURVE);

    let components = MarketDepthComponents {
        liquidity: liq_score.map(|s| s.round() as u8),
        volume: vol_score.map(|s| s.round() as u8),
        holders: holder_score.map(|s| s.round() as u8),
    };

    // Liquidity is load-bearing: without it there is no defensible statement
    // about whether a price is executable, whatever the other two say.
    let Some(liq_value) = liq else {
        return MarketDepth {
            score: None,
            caps: vec![],
            insufficient_reason: Some("no liquidity observation for this mint".to_string()),
            components,
        };
    };

    // Weight only over the components we actually have, so a missing holder
    // count doesn't silently score as zero.
    let mut weighted = 0.0;
    let mut total_weight = 0.0;
    for (score, weight) in [
        (liq_score, WEIGHT_LIQUIDITY),
        (vol_score, WEIGHT_VOLUME),
        (holder_score, WEIGHT_HOLDERS),
    ] {
        if let Some(s) = score {
            weighted += s * weight;
            total_weight += weight;
        }
    }
    if total_weight <= 0.0 {
        return MarketDepth {
            score: None,
            caps: vec![],
            insufficient_reason: Some("no scoreable market inputs".to_string()),
            components,
        };
    }

    let mut score = (weighted / total_weight).clamp(0.0, 100.0);

    // Caps: hard disqualifying facts about the market's shape.
    //
    // These exist because the weighted average alone is too forgiving of the
    // single most misleading case in this universe: an LST with enormous TVL
    // and no trading. dumSOL is real — $132.6M liquidity against $40 of 24h
    // volume (measured 2026-08-10). Liquidity's 50% weight alone floats that to
    // ~52, which would read as a healthy market. You cannot exit there.
    // The cap values are therefore set low enough to actually bind, not as
    // decorative upper bounds.
    let mut caps: Vec<Cap> = Vec::new();
    if liq_value < 50_000.0 {
        caps.push(Cap {
            max: 20.0,
            reason: "thin market (liquidity under $50k)".to_string(),
        });
    }
    if let Some(v) = vol {
        if v < 1_000.0 {
            caps.push(Cap {
                max: 25.0,
                reason: "dormant market (24h volume under $1k)".to_string(),
            });
        }
    }
    if let Some(h) = input.holder_count {
        if h < 100 {
            caps.push(Cap {
                max: 45.0,
                reason: format!("concentrated holder base ({h} holders)"),
            });
        }
    }

    // Report EVERY triggered constraint, then bind to the tightest one. Doing
    // it the other way (apply in order, report only the ones that moved the
    // number) would silently drop true facts: once a $1-volume market is capped
    // to 25, a 35-holder count never "applies" — yet both are things a holder
    // deciding whether to exit needs to see.
    let tightest = caps.iter().map(|c| c.max).fold(f64::INFINITY, f64::min);
    if tightest.is_finite() {
        score = score.min(tightest);
    }

    MarketDepth {
        score: Some(score.round() as u8),
        caps: caps.into_iter().map(|c| c.reason).collect(),
        insufficient_reason: None,
        components,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn dec(s: &str) -> Option<Decimal> {
        Some(Decimal::from_str(s).unwrap())
    }

    /// Real production readings, measured 2026-08-10. The ordering between them
    /// is the property that actually matters: a score that ranks sharkSOL above
    /// jitoSOL is useless no matter what the absolute numbers are.
    #[test]
    fn ranks_real_assets_in_the_right_order() {
        let jito = market_depth(MarketDepthInput {
            liquidity_usd: dec("785794605.74"),
            volume_24h_usd: dec("6170628.39"),
            holder_count: Some(185_395),
        });
        let hylo = market_depth(MarketDepthInput {
            liquidity_usd: dec("14492572.55"),
            volume_24h_usd: dec("66243.81"),
            holder_count: Some(2_575),
        });
        let shark = market_depth(MarketDepthInput {
            liquidity_usd: dec("143.0"),
            volume_24h_usd: dec("0.0"),
            holder_count: Some(35),
        });

        let (j, h, s) = (
            jito.score.unwrap(),
            hylo.score.unwrap(),
            shark.score.unwrap(),
        );
        assert!(j > h, "jitoSOL ({j}) must outrank hyloSOL ({h})");
        assert!(h > s, "hyloSOL ({h}) must outrank sharkSOL ({s})");
        assert!(
            j >= 80,
            "a $785M/185k-holder market should score high, got {j}"
        );
        assert!(s <= 35, "a $143 market must score near the floor, got {s}");
    }

    /// The exact failure the hardcoded `deep` Set produced: it ranked mSOL and
    /// JupSOL as top-tier while bbSOL/BNSOL sat in the generic bucket, even
    /// though the latter have 15-500x the DEX liquidity.
    #[test]
    fn corrects_the_hardcoded_deep_set_error() {
        // mSOL: $5.58M liquidity — real, but not top tier.
        let msol = market_depth(MarketDepthInput {
            liquidity_usd: dec("5583867.0"),
            volume_24h_usd: dec("2144076.0"),
            holder_count: Some(145_848),
        })
        .score
        .unwrap();
        // bbSOL: $96.1M liquidity — was NOT in the hardcoded "deep" set.
        let bbsol = market_depth(MarketDepthInput {
            liquidity_usd: dec("96129354.0"),
            volume_24h_usd: dec("230649.0"),
            holder_count: Some(11_358),
        })
        .score
        .unwrap();
        assert!(
            bbsol > msol,
            "bbSOL ($96M) must outrank mSOL ($5.6M); got bbSOL={bbsol} mSOL={msol}"
        );
    }

    #[test]
    fn missing_liquidity_yields_null_not_zero() {
        let out = market_depth(MarketDepthInput {
            liquidity_usd: None,
            volume_24h_usd: dec("1000000.0"),
            holder_count: Some(50_000),
        });
        assert_eq!(out.score, None, "never fabricate a score without liquidity");
        assert!(out.insufficient_reason.is_some());
        // Components we DID observe are still reported, so the UI can explain.
        assert!(out.components.volume.is_some());
        assert!(out.components.holders.is_some());
        assert_eq!(out.components.liquidity, None);
    }

    #[test]
    fn partial_inputs_score_on_what_exists() {
        // Liquidity only: scored, not penalized for the absent components.
        let out = market_depth(MarketDepthInput {
            liquidity_usd: dec("100000000.0"),
            volume_24h_usd: None,
            holder_count: None,
        });
        assert_eq!(out.score, Some(100));
        assert_eq!(out.components.volume, None);
    }

    #[test]
    fn caps_only_pull_down_and_are_reported() {
        // Huge holder base and volume cannot rescue a $10k pool.
        let out = market_depth(MarketDepthInput {
            liquidity_usd: dec("10000.0"),
            volume_24h_usd: dec("50000000.0"),
            holder_count: Some(1_000_000),
        });
        assert!(out.score.unwrap() <= 35, "thin-market cap must bind");
        assert!(out.caps.iter().any(|c| c.contains("thin market")));
    }

    #[test]
    fn dormant_deep_pool_is_capped() {
        // definSOL-like: $22M sitting there, essentially zero trading.
        let out = market_depth(MarketDepthInput {
            liquidity_usd: dec("22280125.0"),
            volume_24h_usd: dec("1.0"),
            holder_count: Some(35),
        });
        assert!(out.score.unwrap() <= 25);
        // BOTH facts are reported even though only the tightest one binds.
        assert!(out.caps.iter().any(|c| c.contains("dormant")));
        assert!(out.caps.iter().any(|c| c.contains("concentrated")));
    }

    /// REGRESSION: the case that proved the first cap values were decorative.
    /// dumSOL, measured 2026-08-10; $132.6M of liquidity against $40 of 24h
    /// volume. Liquidity's 50% weight alone floated this to ~52 ("healthy") in
    /// the first draft. A pool nobody trades is not a market you can exit.
    #[test]
    fn huge_tvl_with_no_trading_is_not_a_healthy_market() {
        let out = market_depth(MarketDepthInput {
            liquidity_usd: dec("132621532.0"),
            volume_24h_usd: dec("40.0"),
            holder_count: Some(114),
        });
        let score = out.score.unwrap();
        assert!(
            score <= 25,
            "a $132M pool with $40/day of volume must not read as healthy; got {score}"
        );
        assert!(out.caps.iter().any(|c| c.contains("dormant")));
        // The liquidity component itself is still honestly reported as high —
        // the cap bounds the composite, it does not rewrite the input.
        assert_eq!(out.components.liquidity, Some(100));
    }

    #[test]
    fn interpolation_is_monotonic_and_bounded() {
        let mut prev = 0.0;
        for v in [0.0, 1_000.0, 50_000.0, 250_000.0, 1e6, 1e7, 1e8, 1e12] {
            let s = interpolate(v, LIQUIDITY_CURVE);
            assert!(s >= prev, "curve must be non-decreasing at {v}");
            assert!((0.0..=100.0).contains(&s), "score out of range at {v}");
            prev = s;
        }
    }

    /// Zero is a real observation of "no volume", NOT missing data; it must
    /// score, and it must trigger the dormant cap rather than being ignored.
    #[test]
    fn zero_volume_is_scored_not_skipped() {
        let out = market_depth(MarketDepthInput {
            liquidity_usd: dec("2000000.0"),
            volume_24h_usd: dec("0"),
            holder_count: Some(5_000),
        });
        assert_eq!(out.components.volume, Some(0));
        assert!(out.caps.iter().any(|c| c.contains("dormant")));
    }
}
