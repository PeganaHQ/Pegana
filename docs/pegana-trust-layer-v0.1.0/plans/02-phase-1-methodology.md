> ⚠️ **AMENDED** — see [`../AMENDMENTS.md`](../AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original plan preserved below as historical reference.

---

# Phase 1 — Methodology Crate Foundation

**Spec reference**: `../05-methodology-crate.md`
**Acceptance criteria covered**: AC1-AC5
**Dependencies**: none (foundation)
**Blocks**: Phase 2, Phase 3, Phase 8 (replay CLI consumes the same crate)
**Estimated duration**: 2-3 days focused

---

## Overview

Build `crates/methodology` — a new lib crate with pure functions extracted from the engine. No async, no I/O, no global state. Same functions called by `engine-rs` at runtime AND by `pegana-replay-cli` for offline verification.

7 tasks. TDD throughout. Each task ends with a commit.

---

## Task 1.1 — Create methodology crate skeleton

**Files**:
- Create: `crates/methodology/Cargo.toml`
- Create: `crates/methodology/src/lib.rs`
- Create: `crates/methodology/src/{discount,ewma,thresholds,transition,version,canonical,receipt}.rs` (stubs)
- Create: `crates/methodology/CHANGELOG.md`
- Modify: `Cargo.toml` (workspace members)

- [ ] **Step 1**: Create crate manifest

Write `crates/methodology/Cargo.toml`:

```toml
[package]
name        = "pegana-methodology"
version     = "0.1.0"
edition     = "2021"
description = "Pure, versioned methodology functions for Pegana's peg-risk engine. Used by the engine at runtime and by pegana-replay-cli for offline verification."
license     = "MIT"
repository  = "https://github.com/lrafasouza/pegana"

[dependencies]
pegana_common              = { path = "../common" }
rust_decimal               = { workspace = true }
serde                      = { workspace = true }
serde_json                 = { workspace = true }
chrono                     = { workspace = true }
toml                       = { workspace = true }
thiserror                  = { workspace = true }
sha2                       = "0.10"
serde_json_canonicalizer   = "0.3"

[dev-dependencies]
proptest = "1"
```

- [ ] **Step 2**: Create lib root with public re-exports

Write `crates/methodology/src/lib.rs`:

```rust
//! pegana-methodology — pure functions that turn raw inputs into peg-state decisions.
//!
//! Every function is deterministic and side-effect free. Engine calls them at
//! runtime; pegana-replay-cli calls the same functions offline to verify alerts.
//! No tokio, no I/O, no global state.

pub mod canonical;
pub mod discount;
pub mod ewma;
pub mod receipt;
pub mod thresholds;
pub mod transition;
pub mod version;

pub use canonical::{canonical_assets_hash, canonical_receipt_hash, hex_sha256, MethodologyError};
pub use discount::{compute_discount, is_plausible_discount_sample};
pub use ewma::apply_ewma_pure;
pub use receipt::{Computed, InputsFrozen, PythEntry, Receipt};
pub use thresholds::{
    is_direction_sensitive, state_for_bps_discount, state_for_bps_discount_aware, state_for_cr,
};
pub use transition::{transition_decide, TransitionDecision};
pub use version::{methodology_git_sha, methodology_version};
```

- [ ] **Step 3**: Add empty module stubs

```bash
mkdir -p crates/methodology/src
```

Write each as `//! one-line doc` stub (will be filled in subsequent tasks):

```rust
// crates/methodology/src/discount.rs
//! Discount computation and plausibility checks.

// crates/methodology/src/ewma.rs
//! EWMA smoothing.

// crates/methodology/src/thresholds.rs
//! Threshold resolution per asset class.

// crates/methodology/src/transition.rs
//! Hysteresis state-machine step.

// crates/methodology/src/version.rs
//! Methodology version identity.

// crates/methodology/src/canonical.rs
//! Canonical JSON / TOML hashing per RFC 8785.

// crates/methodology/src/receipt.rs
//! Receipt and frozen-input types.
```

- [ ] **Step 4**: Create CHANGELOG.md

Write `crates/methodology/CHANGELOG.md`:

```markdown
# pegana-methodology changelog

## 0.1.0 — 2026-05-29

- Initial public release.
- Extracted pure functions from pegana-engine v0.1.0; no behavior change.
- Provides: compute_discount, apply_ewma_pure, transition_decide,
  state_for_bps_discount*, state_for_cr, is_plausible_discount_sample,
  canonical_assets_hash, canonical_receipt_hash, methodology_version,
  methodology_git_sha.
- Receipt schema: v1.
```

- [ ] **Step 5**: Register crate in workspace

Modify root `Cargo.toml` `members` array:

```toml
[workspace]
resolver = "2"
members = [
    "crates/common",
    "crates/indexer-rs",
    "crates/engine-rs",
    "crates/api-rs",
    "crates/dispatcher-rs",
    "crates/methodology",        # NEW
    "crates/pegana-replay-cli",  # NEW (will be created in Phase 8)
    "crates/xtask",
]
```

(The `pegana-replay-cli` reference will be missing until Phase 8 — comment it out for now if Phase 8 hasn't run yet, OR add the stub directory in this task.)

- [ ] **Step 6**: Verify crate builds

```bash
cargo check -p pegana-methodology
```

Expected: `Checking pegana-methodology v0.1.0` then `Finished` with no errors.

If `serde_json_canonicalizer` resolution fails: `cargo update -p serde_json_canonicalizer`.

- [ ] **Step 7**: Commit

```bash
git add Cargo.toml crates/methodology/
git commit -m "$(cat <<'EOF'
feat(methodology): scaffold pegana-methodology crate

Empty module stubs + crate registration. Will be populated by
Tasks 1.2-1.7.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 1.2 — Move thresholds.rs from engine to methodology

**Files**:
- Modify: `crates/methodology/src/thresholds.rs` (replace stub)
- (Phase 2 deletes `crates/engine-rs/src/thresholds.rs`; in this task, we copy)

- [ ] **Step 1**: Copy `crates/engine-rs/src/thresholds.rs` content

Replace `crates/methodology/src/thresholds.rs` with the existing engine code:

```rust
//! Threshold resolution per asset class.

use pegana_common::{AssetClass, PegState};
use rust_decimal::Decimal;
use std::collections::HashMap;

/// Yield-bearing wrappers (USDY/sUSD/syrupUSDC/sUSDe/ONyc/pbUSDC) only
/// care about the discount side — market < NAV is the redemption-stress
/// signal. Market > NAV ("premium") is just thin secondary liquidity.
pub fn is_direction_sensitive(class: AssetClass) -> bool {
    matches!(class, AssetClass::StableYield)
}

/// Direction-aware variant of state_for_bps_discount.
pub fn state_for_bps_discount_aware(
    class: AssetClass,
    discount: Decimal,
    thresholds: &HashMap<String, u32>,
) -> PegState {
    if is_direction_sensitive(class) && discount < Decimal::ZERO {
        return PegState::Pegged;
    }
    state_for_bps_discount(discount, thresholds)
}

/// Convert smoothed discount → state using BPS thresholds.
pub fn state_for_bps_discount(
    discount: Decimal,
    thresholds: &HashMap<String, u32>,
) -> PegState {
    let abs_bps = (discount.abs() * Decimal::from(10_000u32)).to_string();
    let abs_bps: u32 = abs_bps
        .split('.')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let drift = thresholds
        .get("drift")
        .or_else(|| thresholds.get("drift_bps"))
        .copied()
        .unwrap_or(20);
    let depeg = thresholds
        .get("depeg")
        .or_else(|| thresholds.get("depeg_bps"))
        .copied()
        .unwrap_or(100);
    let critical = thresholds
        .get("critical")
        .or_else(|| thresholds.get("critical_bps"))
        .copied()
        .unwrap_or(300);

    match abs_bps {
        n if n >= critical => PegState::Critical,
        n if n >= depeg => PegState::Depeg,
        n if n >= drift => PegState::Drift,
        _ => PegState::Pegged,
    }
}

/// CR-based state for hyUSD-style CDP stables.
pub fn state_for_cr(cr: Decimal, thresholds: &HashMap<String, u32>) -> PegState {
    let drift = thresholds
        .get("drift")
        .or_else(|| thresholds.get("cr_drift"))
        .copied()
        .unwrap_or(150);
    let depeg = thresholds
        .get("depeg")
        .or_else(|| thresholds.get("cr_depeg"))
        .copied()
        .unwrap_or(130);
    let critical = thresholds
        .get("critical")
        .or_else(|| thresholds.get("cr_critical"))
        .copied()
        .unwrap_or(110);
    let black_swan = thresholds
        .get("black_swan")
        .or_else(|| thresholds.get("cr_black_swan"))
        .copied()
        .unwrap_or(100);

    let cr_pct = (cr * Decimal::from(100u32))
        .to_string()
        .split('.')
        .next()
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0)
        .max(0) as u32;

    match cr_pct {
        n if n < black_swan => PegState::BlackSwan,
        n if n < critical => PegState::Critical,
        n if n < depeg => PegState::Depeg,
        n if n < drift => PegState::Drift,
        _ => PegState::Pegged,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn bps_thresholds() -> HashMap<String, u32> {
        let mut m = HashMap::new();
        m.insert("drift_bps".into(), 20);
        m.insert("depeg_bps".into(), 100);
        m.insert("critical_bps".into(), 300);
        m
    }

    fn cr_thresholds() -> HashMap<String, u32> {
        let mut m = HashMap::new();
        m.insert("cr_drift".into(), 150);
        m.insert("cr_depeg".into(), 130);
        m.insert("cr_critical".into(), 110);
        m.insert("cr_black_swan".into(), 100);
        m
    }

    #[test]
    fn bps_pegged() {
        assert_eq!(state_for_bps_discount(Decimal::from_str("0.0010").unwrap(), &bps_thresholds()), PegState::Pegged);
    }

    #[test]
    fn bps_drift() {
        assert_eq!(state_for_bps_discount(Decimal::from_str("0.0050").unwrap(), &bps_thresholds()), PegState::Drift);
    }

    #[test]
    fn bps_depeg() {
        assert_eq!(state_for_bps_discount(Decimal::from_str("0.0150").unwrap(), &bps_thresholds()), PegState::Depeg);
    }

    #[test]
    fn bps_critical_negative() {
        assert_eq!(state_for_bps_discount(Decimal::from_str("-0.0350").unwrap(), &bps_thresholds()), PegState::Critical);
    }

    #[test]
    fn yield_class_ignores_premium_side() {
        assert_eq!(
            state_for_bps_discount_aware(AssetClass::StableYield, Decimal::from_str("-0.0200").unwrap(), &bps_thresholds()),
            PegState::Pegged,
        );
        assert_eq!(
            state_for_bps_discount_aware(AssetClass::StableYield, Decimal::from_str("0.0200").unwrap(), &bps_thresholds()),
            PegState::Depeg,
        );
    }

    #[test]
    fn lst_class_remains_symmetric() {
        for d in &["-0.0150", "0.0150"] {
            assert_eq!(
                state_for_bps_discount_aware(AssetClass::Lst, Decimal::from_str(d).unwrap(), &bps_thresholds()),
                PegState::Depeg,
            );
        }
    }

    #[test]
    fn cr_healthy() {
        assert_eq!(state_for_cr(Decimal::from(2), &cr_thresholds()), PegState::Pegged);
    }

    #[test]
    fn cr_drift() {
        assert_eq!(state_for_cr(Decimal::from_str("1.40").unwrap(), &cr_thresholds()), PegState::Drift);
    }

    #[test]
    fn cr_critical() {
        assert_eq!(state_for_cr(Decimal::from_str("1.05").unwrap(), &cr_thresholds()), PegState::Critical);
    }

    #[test]
    fn cr_black_swan() {
        assert_eq!(state_for_cr(Decimal::from_str("0.95").unwrap(), &cr_thresholds()), PegState::BlackSwan);
    }
}
```

- [ ] **Step 2**: Run moved tests

```bash
cargo test -p pegana-methodology thresholds
```

Expected: `test result: ok. 10 passed`.

- [ ] **Step 3**: Commit

```bash
git add crates/methodology/src/thresholds.rs
git commit -m "$(cat <<'EOF'
feat(methodology): move thresholds module from engine

10 existing tests pass unchanged. Function signatures identical;
only the crate location moved. Engine still has its own thresholds.rs
until Task 2.1 deletes it.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 1.3 — Extract `compute_discount` and plausibility check

**Files**: `crates/methodology/src/discount.rs`

- [ ] **Step 1**: Replace stub with implementation + tests

Write `crates/methodology/src/discount.rs`:

```rust
//! Discount computation and plausibility checks.

use pegana_common::AssetClass;
use rust_decimal::Decimal;

/// Compute signed discount `1 - market/intrinsic`. For LSTs with SOL
/// numeraire path available, prefer SOL-denominated values (cancels
/// pyth(SOL/USD) multiplier race).
pub fn compute_discount(
    intrinsic: Decimal,
    market: Decimal,
    intrinsic_sol: Option<Decimal>,
    market_sol: Option<Decimal>,
    class: AssetClass,
) -> Decimal {
    if intrinsic.is_zero() {
        return Decimal::ZERO;
    }
    if matches!(class, AssetClass::Lst) {
        if let (Some(i_sol), Some(m_sol)) = (intrinsic_sol, market_sol) {
            if !i_sol.is_zero() {
                return Decimal::ONE - (m_sol / i_sol);
            }
        }
    }
    Decimal::ONE - (market / intrinsic)
}

/// Discount samples with |d| > 1.0 are physically impossible.
pub fn is_plausible_discount_sample(d: Decimal) -> bool {
    d.abs() <= Decimal::ONE
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn zero_intrinsic_returns_zero() {
        let d = compute_discount(Decimal::ZERO, Decimal::ONE, None, None, AssetClass::StableFiat);
        assert_eq!(d, Decimal::ZERO);
    }

    #[test]
    fn stable_uses_usd_path() {
        let d = compute_discount(
            Decimal::from_str("1.00").unwrap(),
            Decimal::from_str("0.99").unwrap(),
            None, None, AssetClass::StableFiat,
        );
        assert_eq!(d, Decimal::from_str("0.01").unwrap());
    }

    #[test]
    fn lst_prefers_sol_path_when_both_present() {
        // USD path would say drift (multiplier race), SOL path says 0.
        let intrinsic_usd: Decimal = "111.7".parse().unwrap();
        let market_usd: Decimal = "112.57".parse().unwrap();
        let i_sol: Decimal = "1.117".parse().unwrap();
        let m_sol: Decimal = "1.117".parse().unwrap();
        let d = compute_discount(intrinsic_usd, market_usd, Some(i_sol), Some(m_sol), AssetClass::Lst);
        assert_eq!(d, Decimal::ZERO);
    }

    #[test]
    fn lst_falls_back_to_usd_when_sol_missing() {
        let d = compute_discount(
            Decimal::from_str("1.10").unwrap(),
            Decimal::from_str("1.09").unwrap(),
            None, None, AssetClass::Lst,
        );
        assert!((d - Decimal::from_str("0.0090909").unwrap()).abs() < Decimal::from_str("0.0001").unwrap());
    }

    #[test]
    fn plausibility_rejects_huge_samples() {
        assert!(!is_plausible_discount_sample(Decimal::from_str("-1160.47").unwrap()));
        assert!(!is_plausible_discount_sample(Decimal::from_str("2.5").unwrap()));
        assert!(is_plausible_discount_sample(Decimal::from_str("0.0024").unwrap()));
        assert!(is_plausible_discount_sample(Decimal::from_str("-1").unwrap()));
        assert!(is_plausible_discount_sample(Decimal::ONE));
    }
}
```

- [ ] **Step 2**: Run tests

```bash
cargo test -p pegana-methodology discount
```

Expected: `test result: ok. 5 passed`.

- [ ] **Step 3**: Commit

```bash
git add crates/methodology/src/discount.rs
git commit -m "$(cat <<'EOF'
feat(methodology): extract compute_discount + plausibility check

Mirrors engine main.rs:353-362 (discount logic) and lines 680-682
(plausibility). Now pure functions the replay CLI can call directly.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 1.4 — Extract `apply_ewma_pure` with property tests

**Files**: `crates/methodology/src/ewma.rs`

- [ ] **Step 1**: Write pure function + property tests

Replace `crates/methodology/src/ewma.rs`:

```rust
//! EWMA smoothing — pure formula extracted from engine state.rs:245-254.

use rust_decimal::Decimal;

/// Apply one EWMA step. When `prev` is `None`, result seeds at `raw`.
/// Otherwise: `alpha * raw + (1 - alpha) * prev`.
pub fn apply_ewma_pure(raw: Decimal, prev: Option<Decimal>, alpha: Decimal) -> Decimal {
    match prev {
        None => raw,
        Some(p) => alpha * raw + (Decimal::ONE - alpha) * p,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use std::str::FromStr;

    #[test]
    fn seeds_at_raw_when_no_prev() {
        let raw = Decimal::from_str("0.01").unwrap();
        assert_eq!(apply_ewma_pure(raw, None, Decimal::from_str("0.3").unwrap()), raw);
    }

    #[test]
    fn classic_blend() {
        let r = apply_ewma_pure(
            Decimal::ZERO,
            Some(Decimal::from_str("0.01").unwrap()),
            Decimal::from_str("0.3").unwrap(),
        );
        assert_eq!(r, Decimal::from_str("0.007").unwrap());
    }

    #[test]
    fn alpha_zero_returns_prev() {
        let prev = Decimal::from_str("0.005").unwrap();
        let raw = Decimal::from_str("999").unwrap();
        assert_eq!(apply_ewma_pure(raw, Some(prev), Decimal::ZERO), prev);
    }

    #[test]
    fn alpha_one_returns_raw() {
        let prev = Decimal::from_str("0.005").unwrap();
        let raw = Decimal::from_str("0.999").unwrap();
        assert_eq!(apply_ewma_pure(raw, Some(prev), Decimal::ONE), raw);
    }

    proptest! {
        #[test]
        fn output_bounded_between_raw_and_prev(
            raw_int in -1_000_000i64..1_000_000i64,
            prev_int in -1_000_000i64..1_000_000i64,
            alpha_int in 0u32..=100,
        ) {
            let raw = Decimal::new(raw_int, 6);
            let prev = Decimal::new(prev_int, 6);
            let alpha = Decimal::new(alpha_int as i64, 2);
            let out = apply_ewma_pure(raw, Some(prev), alpha);
            let lo = raw.min(prev);
            let hi = raw.max(prev);
            prop_assert!(out >= lo && out <= hi, "out={} not in [{}, {}]", out, lo, hi);
        }
    }
}
```

- [ ] **Step 2**: Run tests (including property test with 256 cases)

```bash
cargo test -p pegana-methodology ewma
```

Expected: 4 unit + 1 property test pass.

- [ ] **Step 3**: Commit

```bash
git add crates/methodology/src/ewma.rs
git commit -m "$(cat <<'EOF'
feat(methodology): extract apply_ewma_pure with property tests

Pure formula matches engine state.rs:245-254. Property test verifies
output is always bounded between min(raw, prev) and max(raw, prev) —
a useful invariant the engine code didn't enforce explicitly.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 1.5 — Extract `transition_decide` with truth-table tests

**Files**: `crates/methodology/src/transition.rs`

- [ ] **Step 1**: Write pure transition + TransitionDecision type

Replace `crates/methodology/src/transition.rs`:

```rust
//! Hysteresis state-machine step extracted from engine state.rs:258-296.
//! Takes `now` explicitly so replay CLI is deterministic.

use chrono::{DateTime, Utc};
use pegana_common::PegState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransitionDecision {
    pub new_last_state: PegState,
    pub new_candidate_state: Option<PegState>,
    pub new_candidate_since: Option<DateTime<Utc>>,
}

pub fn transition_decide(
    current_last_state: PegState,
    candidate: PegState,
    prev_candidate_state: Option<PegState>,
    prev_candidate_since: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
    confirm_up_secs: i64,
    decay_down_secs: i64,
) -> TransitionDecision {
    let strictness = state_strictness(candidate);
    let current_strictness = state_strictness(current_last_state);

    if candidate == current_last_state {
        return TransitionDecision {
            new_last_state: current_last_state,
            new_candidate_state: None,
            new_candidate_since: None,
        };
    }

    if prev_candidate_state != Some(candidate) {
        return TransitionDecision {
            new_last_state: current_last_state,
            new_candidate_state: Some(candidate),
            new_candidate_since: Some(now),
        };
    }

    let since = prev_candidate_since.unwrap_or(now);
    let needed = if strictness > current_strictness {
        confirm_up_secs
    } else {
        decay_down_secs
    };
    if (now - since).num_seconds() >= needed {
        TransitionDecision {
            new_last_state: candidate,
            new_candidate_state: None,
            new_candidate_since: None,
        }
    } else {
        TransitionDecision {
            new_last_state: current_last_state,
            new_candidate_state: prev_candidate_state,
            new_candidate_since: prev_candidate_since,
        }
    }
}

fn state_strictness(s: PegState) -> u8 {
    match s {
        PegState::Pegged => 0,
        PegState::Drift => 1,
        PegState::Depeg => 2,
        PegState::Critical => 3,
        PegState::BlackSwan => 4,
        PegState::Unknown => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn t0() -> DateTime<Utc> { Utc::now() }

    #[test]
    fn no_op_when_candidate_equals_current() {
        let now = t0();
        let r = transition_decide(PegState::Drift, PegState::Drift, None, None, now, 30, 120);
        assert_eq!(r.new_last_state, PegState::Drift);
        assert_eq!(r.new_candidate_state, None);
    }

    #[test]
    fn new_candidate_does_not_flip_immediately() {
        let now = t0();
        let r = transition_decide(PegState::Pegged, PegState::Drift, None, None, now, 30, 120);
        assert_eq!(r.new_last_state, PegState::Pegged);
        assert_eq!(r.new_candidate_state, Some(PegState::Drift));
        assert_eq!(r.new_candidate_since, Some(now));
    }

    #[test]
    fn candidate_matures_after_confirm_up_secs() {
        let now = t0();
        let since = now - Duration::seconds(31);
        let r = transition_decide(PegState::Pegged, PegState::Drift, Some(PegState::Drift), Some(since), now, 30, 120);
        assert_eq!(r.new_last_state, PegState::Drift);
    }

    #[test]
    fn downward_uses_decay_window() {
        let now = t0();
        let since = now - Duration::seconds(60);  // < decay window 120s
        let r = transition_decide(PegState::Drift, PegState::Pegged, Some(PegState::Pegged), Some(since), now, 30, 120);
        assert_eq!(r.new_last_state, PegState::Drift, "must wait full decay");

        let since2 = now - Duration::seconds(121);  // > 120s
        let r2 = transition_decide(PegState::Drift, PegState::Pegged, Some(PegState::Pegged), Some(since2), now, 30, 120);
        assert_eq!(r2.new_last_state, PegState::Pegged);
    }
}
```

- [ ] **Step 2**: Run tests

```bash
cargo test -p pegana-methodology transition
```

Expected: 4 passed.

- [ ] **Step 3**: Commit

```bash
git add crates/methodology/src/transition.rs
git commit -m "$(cat <<'EOF'
feat(methodology): extract transition_decide with explicit now

Mirrors engine state.rs:258-296 hysteresis logic. Returns
TransitionDecision value the caller writes back to its cache. Now is
explicit, eliminating the implicit Utc::now() call that broke replay
determinism.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 1.6 — Methodology version identity helpers

**Files**: `crates/methodology/src/version.rs`

- [ ] **Step 1**: Implement helpers

Replace `crates/methodology/src/version.rs`:

```rust
//! Methodology version identity. CLI compares these to receipt's recorded
//! versions to detect mismatched binaries.

pub fn methodology_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn methodology_git_sha() -> Option<&'static str> {
    option_env!("PEGANA_GIT_SHA")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_matches_cargo_toml() {
        assert_eq!(methodology_version(), "0.1.0");
    }

    #[test]
    fn git_sha_is_optional() {
        let _ = methodology_git_sha();  // None in test, set in release Docker build
    }
}
```

- [ ] **Step 2**: Run tests

```bash
cargo test -p pegana-methodology version
```

Expected: 2 passed.

- [ ] **Step 3**: Commit

```bash
git add crates/methodology/src/version.rs
git commit -m "$(cat <<'EOF'
feat(methodology): version identity helpers

methodology_version() reads CARGO_PKG_VERSION at compile time.
methodology_git_sha() is populated by Docker build arg PEGANA_GIT_SHA;
falls back to None in local dev (receipts mark as "dev build").

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 1.7 — Receipt structs + canonical hashing

**Files**: `crates/methodology/src/receipt.rs`, `crates/methodology/src/canonical.rs`

- [ ] **Step 1**: Define Receipt structs

Replace `crates/methodology/src/receipt.rs`:

```rust
//! Receipt and frozen-input types for audit persistence.

use chrono::{DateTime, Utc};
use pegana_common::{AssetClass, PegState};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PythEntry {
    pub price: Decimal,
    pub confidence: Decimal,
    pub publish_time: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputsFrozen {
    pub asset: String,
    pub class: AssetClass,
    pub now: DateTime<Utc>,
    pub alpha: Decimal,
    pub intrinsic_usd: Decimal,
    pub market_usd: Decimal,
    pub intrinsic_sol: Option<Decimal>,
    pub market_sol: Option<Decimal>,
    pub ewma_prev: Option<Decimal>,
    pub hyusd_cr: Option<Decimal>,
    pub previous_state: PegState,
    pub candidate_state: Option<PegState>,
    pub candidate_since: Option<DateTime<Utc>>,
    pub thresholds: HashMap<String, u32>,
    pub threshold_kind: String,
    pub pyth_entries: HashMap<String, PythEntry>,
    pub confirm_up_secs: i64,
    pub decay_down_secs: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Computed {
    pub discount_raw: Decimal,
    pub discount_smooth: Decimal,
    pub final_state: PegState,
    pub confidence_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    pub schema_version: String,
    pub methodology_version: String,
    pub methodology_git_sha: Option<String>,
    pub assets_toml_canonical: String,
    pub inputs_frozen: InputsFrozen,
    pub expected_computed: Computed,
    pub expected_receipt_sha256: String,
}
```

- [ ] **Step 2**: Implement canonical hashing

Replace `crates/methodology/src/canonical.rs`:

```rust
//! Canonical JSON (RFC 8785) and TOML hashing.

use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::receipt::{Computed, InputsFrozen};

#[derive(Debug, Error)]
pub enum MethodologyError {
    #[error("failed to parse assets.toml: {0}")]
    AssetsTomlParse(#[from] toml::de::Error),

    #[error("failed to serialize canonical TOML: {0}")]
    AssetsTomlSerialize(#[from] toml::ser::Error),

    #[error("canonical JSON encode failed: {0}")]
    CanonicalJson(#[from] serde_json::Error),
}

/// Parse assets.toml, re-serialize in canonical form (sorted keys),
/// then sha256. Comments and whitespace don't affect the hash.
pub fn canonical_assets_hash(toml_str: &str) -> Result<[u8; 32], MethodologyError> {
    let value: toml::Value = toml::from_str(toml_str)?;
    let canonical = toml::to_string(&value)?;
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    Ok(hasher.finalize().into())
}

/// Canonical sha256 of a receipt's content via RFC 8785 JCS encoding.
pub fn canonical_receipt_hash(
    methodology_version: &str,
    methodology_git_sha: Option<&str>,
    assets_toml_canonical: &str,
    inputs_frozen: &InputsFrozen,
    computed: &Computed,
) -> Result<[u8; 32], MethodologyError> {
    let mut hasher = Sha256::new();
    hasher.update(methodology_version.as_bytes());
    hasher.update(b"\x00");
    hasher.update(methodology_git_sha.unwrap_or("").as_bytes());
    hasher.update(b"\x00");
    hasher.update(assets_toml_canonical.as_bytes());
    hasher.update(b"\x00");
    let inputs_bytes = serde_json_canonicalizer::to_string(inputs_frozen)?;
    hasher.update(inputs_bytes.as_bytes());
    hasher.update(b"\x00");
    let computed_bytes = serde_json_canonicalizer::to_string(computed)?;
    hasher.update(computed_bytes.as_bytes());
    Ok(hasher.finalize().into())
}

/// Hex-encode a sha256 digest for CHAR(64) columns.
pub fn hex_sha256(digest: [u8; 32]) -> String {
    digest.iter().fold(String::with_capacity(64), |mut acc, b| {
        acc.push_str(&format!("{:02x}", b));
        acc
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use pegana_common::{AssetClass, PegState};
    use rust_decimal::Decimal;
    use std::collections::HashMap;
    use std::str::FromStr;

    fn sample_inputs() -> InputsFrozen {
        InputsFrozen {
            asset: "USDC".into(),
            class: AssetClass::StableFiat,
            now: Utc::now(),
            alpha: Decimal::from_str("0.3").unwrap(),
            intrinsic_usd: Decimal::ONE,
            market_usd: Decimal::from_str("0.9999").unwrap(),
            intrinsic_sol: None,
            market_sol: None,
            ewma_prev: None,
            hyusd_cr: None,
            previous_state: PegState::Pegged,
            candidate_state: None,
            candidate_since: None,
            thresholds: HashMap::new(),
            threshold_kind: "bps".into(),
            pyth_entries: HashMap::new(),
            confirm_up_secs: 30,
            decay_down_secs: 120,
        }
    }

    fn sample_computed() -> Computed {
        Computed {
            discount_raw: Decimal::from_str("0.0001").unwrap(),
            discount_smooth: Decimal::from_str("0.0001").unwrap(),
            final_state: PegState::Pegged,
            confidence_label: "high".into(),
        }
    }

    #[test]
    fn assets_hash_is_stable_across_comment_changes() {
        let with_comment = "[[assets]]\nsymbol = \"USDC\"\n# important comment\n";
        let without = "[[assets]]\nsymbol = \"USDC\"\n";
        assert_eq!(canonical_assets_hash(with_comment).unwrap(), canonical_assets_hash(without).unwrap());
    }

    #[test]
    fn assets_hash_changes_when_value_changes() {
        let v1 = "[[assets]]\nsymbol = \"USDC\"\n";
        let v2 = "[[assets]]\nsymbol = \"USDT\"\n";
        assert_ne!(canonical_assets_hash(v1).unwrap(), canonical_assets_hash(v2).unwrap());
    }

    #[test]
    fn receipt_hash_is_deterministic() {
        let inputs = sample_inputs();
        let computed = sample_computed();
        let h1 = canonical_receipt_hash("0.1.0", None, "[[assets]]\nsymbol=\"USDC\"\n", &inputs, &computed).unwrap();
        let h2 = canonical_receipt_hash("0.1.0", None, "[[assets]]\nsymbol=\"USDC\"\n", &inputs, &computed).unwrap();
        assert_eq!(h1, h2);
    }

    #[test]
    fn receipt_hash_changes_when_version_changes() {
        let inputs = sample_inputs();
        let computed = sample_computed();
        let h1 = canonical_receipt_hash("0.1.0", None, "x", &inputs, &computed).unwrap();
        let h2 = canonical_receipt_hash("0.2.0", None, "x", &inputs, &computed).unwrap();
        assert_ne!(h1, h2);
    }

    #[test]
    fn hex_encoding_is_64_chars() {
        let digest = [0u8; 32];
        assert_eq!(hex_sha256(digest).len(), 64);
    }
}
```

- [ ] **Step 3**: Run all methodology tests

```bash
cargo test -p pegana-methodology
```

Expected: ~26 tests pass (10 thresholds + 5 discount + 5 ewma + 4 transition + 2 version + 5 canonical).

- [ ] **Step 4**: Commit

```bash
git add crates/methodology/
git commit -m "$(cat <<'EOF'
feat(methodology): receipt structs + canonical hashing (RFC 8785)

Receipt/InputsFrozen/Computed model the audit row. canonical_assets_hash
uses TOML re-serialization (ignores comments/whitespace). canonical_receipt_hash
uses serde_json_canonicalizer (RFC 8785) for cross-arch determinism.
hex_sha256 for CHAR(64) DB storage.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance verification for Phase 1

- [ ] AC1 — `crates/methodology` compiles standalone (`cargo build -p pegana-methodology`)
- [ ] AC2 — 100% line coverage on public API (`cargo tarpaulin -p pegana-methodology`)
- [ ] AC3 — All 10 existing `thresholds.rs` tests migrated and pass
- [ ] AC4 — `proptest` tests pass: 3 invariants on `apply_ewma_pure`, truth table on `transition_decide`
- [ ] AC5 — `canonical_assets_hash` and `canonical_receipt_hash` deterministic (roundtrip test green)

---

## Cross-references

- For the spec defining each function, see `../05-methodology-crate.md`.
- For Phase 2 engine refactor consuming this crate, see `03-phase-2-engine.md`.
- For Phase 8 CLI consuming the same functions offline, see `08-phase-8-9-cli-distribution.md`.
