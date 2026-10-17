use std::collections::HashMap;

use anyhow::{Context, Result};
use chrono::{DateTime, TimeZone, Utc};
use methodology::{
    apply_ewma_pure, canonical_receipt_hash, classify_with_hysteresis, compute_discount,
    hex_sha256, is_plausible_discount_sample, override_final_state, rederive, transition_decide,
    Computed, InputsFrozen, PythEntry, Receipt, DEADBAND_PCT,
};
use pegana_common_verify::{AssetClass, PegState};
use rust_decimal::Decimal;

use super::types::{AssetResult, AssetSeries, Transition};

const ALPHA_STR: &str = "0.3";
const CONFIRM_UP_SECS: i64 = 30;
const DECAY_DOWN_SECS: i64 = 120;

pub struct ReceiptBundle {
    pub inputs_frozen: InputsFrozen,
    pub expected_computed: Computed,
    pub receipt: Receipt,
}

pub fn state_str(state: PegState) -> String {
    match state {
        PegState::Pegged => "PEGGED",
        PegState::Drift => "DRIFT",
        PegState::Depeg => "DEPEG",
        PegState::Critical => "CRITICAL",
        PegState::BlackSwan => "BLACK_SWAN",
        PegState::Unknown => "UNKNOWN",
    }
    .to_string()
}

fn class_from_str(value: &str) -> Result<AssetClass> {
    serde_json::from_value(serde_json::Value::String(value.to_string()))
        .with_context(|| format!("unknown asset class '{value}'"))
}

fn strictness(state: PegState) -> u8 {
    match state {
        PegState::Pegged | PegState::Unknown => 0,
        PegState::Drift => 1,
        PegState::Depeg => 2,
        PegState::Critical => 3,
        PegState::BlackSwan => 4,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn run_asset(
    asset: &str,
    series: &AssetSeries,
    thresholds: &HashMap<String, u32>,
    fidelity: &str,
    methodology_version: &str,
    methodology_git_sha: Option<&str>,
    assets_toml_canonical: &str,
) -> Result<(AssetResult, Vec<ReceiptBundle>)> {
    let class = class_from_str(&series.class)?;

    // Guard the CR latent trap: the engine routes `StableCdp && asset=="hyUSD"`
    // through the collateral-ratio verdict path (`classify_cr_with_hysteresis`,
    // engine-rs/main.rs), but this runner has NO CR branch — `Tick` carries no CR
    // and it would silently classify hyUSD on the bps spread instead. Worse, the
    // receipt would freeze `threshold_kind="bps"`, so the per-tick `rederive`
    // self-check consumes that same wrong basis and AGREES — the divergence would
    // be invisible (exactly the class of bug the missing discount_sanity coverage
    // hid). Hard-error rather than emit a wrong verdict. (USDS is also StableCdp
    // but the engine routes it through bps, so it is intentionally NOT guarded.)
    if class == AssetClass::StableCdp && asset == "hyUSD" {
        anyhow::bail!(
            "backtest runner has no CR verdict path — hyUSD must not be replayed \
             through the bps classifier (would silently diverge from the engine's \
             CR route). Implement classify_cr_with_hysteresis in run_asset first."
        );
    }

    let alpha: Decimal = ALPHA_STR.parse().expect("constant decimal");
    let mut ewma_prev = None;
    let mut previous_state = PegState::Pegged;
    let mut candidate_state = None;
    let mut candidate_since: Option<DateTime<Utc>> = None;
    let mut transitions = Vec::new();
    let mut bundles = Vec::new();
    let mut max_state = PegState::Pegged;
    let mut first_alert = None;
    let mut counted = 0;
    let first_t = series.ticks.first().map(|tick| tick.t);

    for tick in &series.ticks {
        let now = Utc
            .timestamp_opt(tick.t, 0)
            .single()
            .context("bad timestamp")?;
        let has_usable_sol_intrinsic = matches!(class, AssetClass::Lst)
            && tick.intrinsic_sol.is_some_and(|value| !value.is_zero())
            && tick.market_sol.is_some();
        let intrinsic_usd = match tick.intrinsic_usd {
            Some(value) => value,
            None if series.intrinsic.as_deref() == Some("fixed_1_usd") => Decimal::ONE,
            None if has_usable_sol_intrinsic => Decimal::ONE,
            None => continue,
        };
        let discount_raw = match compute_discount(
            intrinsic_usd,
            tick.market_usd,
            tick.intrinsic_sol,
            tick.market_sol,
            class,
        ) {
            Some(discount) => discount,
            None => continue,
        };
        if !is_plausible_discount_sample(discount_raw) {
            continue;
        }
        counted += 1;

        let discount_smooth = match apply_ewma_pure(discount_raw, ewma_prev, alpha) {
            Some(d) => d,
            None => continue,
        };
        let candidate = classify_with_hysteresis(
            class,
            discount_smooth,
            thresholds,
            previous_state,
            DEADBAND_PCT,
        );
        let decision = transition_decide(
            previous_state,
            candidate,
            candidate_state,
            candidate_since,
            now,
            CONFIRM_UP_SECS,
            DECAY_DOWN_SECS,
        );
        let mut final_state = decision.new_last_state;
        let mut next_candidate_state = decision.new_candidate_state;
        let mut next_candidate_since = decision.new_candidate_since;

        // Pyth entries for THIS tick. Empty unless the fixture captured a
        // confidence (`tick.pyth_conf`) — every historical fixture to date has
        // none, so this stays `HashMap::new()` and the receipt hash is
        // byte-identical to before. A present conf materialises one entry
        // (price = the asset's USD market print) so the ADR-0032 gate can be
        // replayed end-to-end.
        let pyth_entries: HashMap<String, PythEntry> = match tick.pyth_conf {
            Some(confidence) => {
                let key = series
                    .market_feed
                    .clone()
                    .unwrap_or_else(|| "PYTH".to_string());
                HashMap::from([(
                    key,
                    PythEntry {
                        price: tick.market_usd,
                        confidence,
                        publish_time: now,
                    },
                )])
            }
            None => HashMap::new(),
        };

        // Intrinsic-liveness (ADR-0038): a fixture may replay a frozen stale
        // backing via `tick.intrinsic_stale`. Absent (every historical fixture)
        // → false → omitted from the hash → golden byte-exact.
        let intrinsic_stale = tick.intrinsic_stale.unwrap_or(false);

        // Sanity + confidence + liveness override → UNKNOWN, via the SINGLE shared
        // `override_final_state` — the exact function the live engine and `rederive`
        // call, so all THREE implementations agree BY CONSTRUCTION. This runner
        // previously carried a hand-rolled copy that missed the ADR-0039 BLACK_SWAN
        // carve-out entirely (P1 audit finding) — a >30% collapse fixture would have
        // backtested as permanent UNKNOWN while the live engine + verifier surfaced
        // BLACK_SWAN. A confirmed BLACK_SWAN now yields to none of the three
        // feed/value gates; and a MATURING BlackSwan candidate is preserved (mirrors
        // the engine's force_unknown carve-out) so the confirm window can complete.
        let overridden = override_final_state(
            class,
            discount_smooth,
            &pyth_entries,
            intrinsic_stale,
            final_state,
        );
        if overridden != final_state {
            final_state = overridden;
            if candidate != PegState::BlackSwan {
                next_candidate_state = None;
                next_candidate_since = None;
            }
        }

        let inputs_frozen = InputsFrozen {
            asset: asset.to_string(),
            class,
            now,
            alpha,
            intrinsic_usd,
            market_usd: tick.market_usd,
            intrinsic_sol: tick.intrinsic_sol,
            market_sol: tick.market_sol,
            ewma_prev,
            hyusd_cr: None,
            previous_state,
            candidate_state,
            candidate_since,
            thresholds: thresholds.clone(),
            threshold_kind: "bps".to_string(),
            pyth_entries,
            confirm_up_secs: CONFIRM_UP_SECS,
            decay_down_secs: DECAY_DOWN_SECS,
            intrinsic_stale,
        };
        let expected_computed = Computed {
            discount_raw,
            discount_smooth,
            final_state,
            confidence_label: "unknown".to_string(),
        };
        let sha = hex_sha256(
            canonical_receipt_hash(
                methodology_version,
                methodology_git_sha,
                assets_toml_canonical,
                &inputs_frozen,
                &expected_computed,
            )
            .context("canonical receipt hash")?,
        );
        let rederived = rederive(&inputs_frozen).context("rederive self-check")?;
        anyhow::ensure!(
            rederived.discount_raw == discount_raw
                && rederived.discount_smooth == discount_smooth
                && rederived.final_state == final_state,
            "rederive mismatch for {asset} at {now}"
        );

        if final_state != previous_state {
            transitions.push(Transition {
                t: now.to_rfc3339(),
                from: state_str(previous_state),
                to: state_str(final_state),
                discount_smooth,
                receipt_sha256: sha.clone(),
            });
            if first_alert.is_none() && strictness(final_state) > 0 {
                first_alert = first_t.map(|start| tick.t - start);
            }
            let receipt = Receipt {
                schema_version: "v2".to_string(),
                methodology_version: methodology_version.to_string(),
                methodology_git_sha: methodology_git_sha.map(str::to_string),
                assets_toml_canonical: assets_toml_canonical.to_string(),
                inputs_frozen: inputs_frozen.clone(),
                expected_computed: expected_computed.clone(),
                expected_receipt_sha256: sha,
                state_reason: None,
            };
            bundles.push(ReceiptBundle {
                inputs_frozen,
                expected_computed,
                receipt,
            });
        }

        if strictness(final_state) > strictness(max_state) {
            max_state = final_state;
        }
        ewma_prev = Some(discount_smooth);
        previous_state = final_state;
        candidate_state = next_candidate_state;
        candidate_since = next_candidate_since;
    }

    Ok((
        AssetResult {
            fidelity: fidelity.to_string(),
            transitions,
            time_to_first_alert_secs: first_alert,
            max_state: state_str(max_state),
            ticks: counted,
        },
        bundles,
    ))
}
