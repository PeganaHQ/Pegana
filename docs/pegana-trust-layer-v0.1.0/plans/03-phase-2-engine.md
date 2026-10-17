> ⚠️ **AMENDED** — see [`../AMENDMENTS.md`](../AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original plan preserved below as historical reference.

---

# Phase 2 — Engine Refactor

**Spec reference**: `../06-engine-changes.md`
**Acceptance criteria covered**: AC6, AC7, AC8, AC9
**Dependencies**: Phase 1 (methodology crate exists)
**Blocks**: Phase 3 (audit persistence depends on refactored push_alert)
**Estimated duration**: 1-2 days

---

## Overview

Engine consumes the new `methodology` crate. `thresholds.rs` deleted from engine. `state.rs::apply_ewma` and `transition` delegate to methodology. `try_recompute` reads `Utc::now()` once and threads through (kills the implicit-now bug that broke replay determinism).

All 5 existing integration tests in `state.rs` MUST pass without modification (except for `transition_is_two_phase_with_hysteresis` which adds the `now` argument).

---

## Task 2.1 — Engine depends on methodology + delete old thresholds.rs

**Files**:
- Modify: `crates/engine-rs/Cargo.toml` (add dep)
- Modify: `crates/engine-rs/src/main.rs` (imports)
- Delete: `crates/engine-rs/src/thresholds.rs`

- [ ] **Step 1**: Add dependency

In `crates/engine-rs/Cargo.toml` `[dependencies]`:

```toml
pegana-methodology = { path = "../methodology" }
```

- [ ] **Step 2**: Update engine main.rs imports

In `crates/engine-rs/src/main.rs`, replace:

```rust
mod state;
mod thresholds;
```

with:

```rust
mod state;
mod onchain_commit;  // NEW — to be filled in Phase 3
```

And replace:

```rust
use thresholds::{state_for_bps_discount_aware, state_for_cr};
```

with:

```rust
use pegana_methodology::{
    apply_ewma_pure, canonical_assets_hash, canonical_receipt_hash, compute_discount,
    hex_sha256, is_plausible_discount_sample, methodology_git_sha, methodology_version,
    state_for_bps_discount_aware, state_for_cr, transition_decide,
    Computed, InputsFrozen as MethInputsFrozen, PythEntry as MethPythEntry, Receipt,
    TransitionDecision,
};
```

Also remove the local `is_plausible_discount_sample` function (lines 680-682 in current main.rs) and its `#[cfg(test)]` test block (lines 684-725) — those now live in `methodology`.

- [ ] **Step 3**: Delete engine's old thresholds.rs

```bash
git rm crates/engine-rs/src/thresholds.rs
```

- [ ] **Step 4**: Verify the engine still builds

```bash
cargo check -p engine-rs
```

Expected: no errors. If imports fail, double-check the `use` line in main.rs matches the methodology's public API.

- [ ] **Step 5**: Create onchain_commit.rs stub (filled in Phase 3)

```rust
// crates/engine-rs/src/onchain_commit.rs
//! Anchor receipt sha256 on-chain via Solana SPL Memo program.
//! Implementation in Task 3.5.
```

- [ ] **Step 6**: Commit

```bash
git add crates/engine-rs/Cargo.toml crates/engine-rs/src/main.rs crates/engine-rs/src/onchain_commit.rs
git rm crates/engine-rs/src/thresholds.rs
git commit -m "$(cat <<'EOF'
refactor(engine): depend on pegana-methodology for pure functions

- Delete engine-rs/src/thresholds.rs (moved to methodology crate)
- Add pegana-methodology dependency
- All threshold + plausibility functions now come from re-exports
- Stub onchain_commit module (implementation in Task 3.5)

No behavior change — pure relocation.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2.2 — Refactor `state.rs::apply_ewma` to delegate

**Files**: `crates/engine-rs/src/state.rs`

- [ ] **Step 1**: Replace `apply_ewma` body

Locate `apply_ewma` (around line 245):

```rust
pub async fn apply_ewma(&self, sym: &str, raw: Decimal, alpha: Decimal) -> Decimal {
    let rt = self.rt(sym).await;
    let mut g = rt.write().await;
    let new = match g.ewma_discount {
        None => raw,
        Some(prev) => alpha * raw + (Decimal::ONE - alpha) * prev,
    };
    g.ewma_discount = Some(new);
    new
}
```

Replace with:

```rust
pub async fn apply_ewma(&self, sym: &str, raw: Decimal, alpha: Decimal) -> Decimal {
    let rt = self.rt(sym).await;
    let mut g = rt.write().await;
    let new = pegana_methodology::apply_ewma_pure(raw, g.ewma_discount, alpha);
    g.ewma_discount = Some(new);
    new
}
```

Cache mutation (read prev, write new) stays in `EngineState`. Math moves to pure function. Behavior identical.

- [ ] **Step 2**: Run existing test

```bash
cargo test -p engine-rs ewma_smooths_across_ticks
```

Expected: PASS — same blending behavior, same test passes.

- [ ] **Step 3**: Commit

```bash
git add crates/engine-rs/src/state.rs
git commit -m "$(cat <<'EOF'
refactor(engine): apply_ewma delegates to methodology

Cache mutation stays in EngineState; EWMA formula moves to the pure
function in pegana-methodology. Existing integration test confirms
behavior preservation.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2.3 — Refactor `state.rs::transition` to take explicit `now`

**Files**:
- Modify: `crates/engine-rs/src/state.rs`
- Modify: `crates/engine-rs/src/main.rs` (caller)

- [ ] **Step 1**: Change `transition` signature and body

Locate `transition` (around line 258 in state.rs):

```rust
pub async fn transition(
    &self,
    sym: &str,
    candidate: PegState,
    confirm_up_secs: i64,
    decay_down_secs: i64,
) -> PegState {
    let rt = self.rt(sym).await;
    let mut g = rt.write().await;
    let now = Utc::now();   // ← REMOVE
    // ... 30 lines of hysteresis logic ...
}
```

Replace with:

```rust
pub async fn transition(
    &self,
    sym: &str,
    candidate: PegState,
    now: chrono::DateTime<chrono::Utc>,   // NEW PARAMETER
    confirm_up_secs: i64,
    decay_down_secs: i64,
) -> PegState {
    let rt = self.rt(sym).await;
    let mut g = rt.write().await;
    let decision = pegana_methodology::transition_decide(
        g.last_state,
        candidate,
        g.candidate_state,
        g.candidate_since,
        now,
        confirm_up_secs,
        decay_down_secs,
    );
    g.last_state = decision.new_last_state;
    g.candidate_state = decision.new_candidate_state;
    g.candidate_since = decision.new_candidate_since;
    g.last_state
}
```

- [ ] **Step 2**: Update caller in main.rs::try_recompute

Locate (currently around line 419):

```rust
let final_state = engine
    .transition(asset, new_state, CONFIRM_UP_SECS, DECAY_DOWN_SECS)
    .await;
```

Replace with:

```rust
let now = Utc::now();
let final_state = engine
    .transition(asset, new_state, now, CONFIRM_UP_SECS, DECAY_DOWN_SECS)
    .await;
```

Also adjust line 429 to reuse `now` instead of calling `Utc::now()` again:

```rust
let ts = now;   // was: let ts = Utc::now();
```

- [ ] **Step 3**: Update existing integration test

The test `transition_is_two_phase_with_hysteresis` in `state.rs` (`#[cfg(test)] mod integration_tests`) needs the `now` argument.

Find:

```rust
let s1 = e.transition("USDC", PegState::Drift, 30, 120).await;
```

Replace with:

```rust
let now = chrono::Utc::now();
let s1 = e.transition("USDC", PegState::Drift, now, 30, 120).await;
```

Same for the second call in that test:

```rust
let s2 = e.transition("USDC", PegState::Drift, 0, 120).await;
```
→
```rust
let s2 = e.transition("USDC", PegState::Drift, now, 0, 120).await;
```

- [ ] **Step 4**: Add new test asserting explicit-now behavior

In `state.rs` `#[cfg(test)] mod integration_tests`:

```rust
#[tokio::test]
async fn transition_takes_explicit_now_argument() {
    let e = fresh_engine();
    let now1 = chrono::Utc::now();
    let r1 = e.transition("USDC", PegState::Drift, now1, 30, 120).await;
    assert_eq!(r1, PegState::default(), "first sighting stays as default");

    // Second call at same `now` should behave deterministically
    let r2 = e.transition("USDC", PegState::Drift, now1, 0, 120).await;
    assert_eq!(r2, PegState::Drift, "with 0s confirm window, second sighting matures");
}
```

- [ ] **Step 5**: Run all engine tests

```bash
cargo test -p engine-rs
```

Expected: all 5 existing tests + the new one (6 total) pass.

- [ ] **Step 6**: Commit

```bash
git add crates/engine-rs/src/
git commit -m "$(cat <<'EOF'
refactor(engine): transition takes explicit `now` parameter

Eliminates the implicit Utc::now() call that broke replay determinism.
try_recompute reads `now` once at the top and threads into transition()
and the alert timestamp, so the entire decision pipeline uses one
consistent clock reading.

New test transition_takes_explicit_now_argument validates the API
change. All 5 existing integration tests pass.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2.4 — Compute discount via methodology

**Files**: `crates/engine-rs/src/main.rs`

- [ ] **Step 1**: Replace inline discount math

In `crates/engine-rs/src/main.rs::try_recompute`, locate the discount block (lines 353-362):

```rust
let discount_raw = if intrinsic.is_zero() {
    Decimal::ZERO
} else if matches!(asset_cfg.class, AssetClass::Lst) {
    match engine.snapshot_sol(asset).await {
        Some((i_sol, m_sol)) if !i_sol.is_zero() => Decimal::ONE - (m_sol / i_sol),
        _ => Decimal::ONE - (market / intrinsic),
    }
} else {
    Decimal::ONE - (market / intrinsic)
};
```

Replace with:

```rust
let (i_sol_opt, m_sol_opt) = match engine.snapshot_sol(asset).await {
    Some((i, m)) => (Some(i), Some(m)),
    None => (None, None),
};
let discount_raw = compute_discount(intrinsic, market, i_sol_opt, m_sol_opt, asset_cfg.class);
```

Also locate the plausibility check (around lines 374-390):

```rust
if !is_plausible_discount_sample(discount_raw) { /* ... */ }
```

This still calls `is_plausible_discount_sample` — but now it's imported from `pegana_methodology` (per Task 2.1 imports). No code change here, just the call site uses the imported function automatically.

- [ ] **Step 2**: Verify engine builds and runs

```bash
cargo test -p engine-rs
```

Expected: all 6 tests still pass, INCLUDING the critical `lst_discount_in_sol_terms_ignores_sol_usd_multiplier_drift` integration test that validates the LST SOL-path preservation.

- [ ] **Step 3**: Commit

```bash
git add crates/engine-rs/src/main.rs
git commit -m "$(cat <<'EOF'
refactor(engine): discount computation via methodology::compute_discount

Inline math replaced with pure function. LST SOL-path preference
preserved (tested by lst_discount_in_sol_terms_ignores_sol_usd_multiplier_drift).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance verification for Phase 2

- [ ] AC6 — `crates/engine-rs/src/thresholds.rs` deleted (`git ls-files crates/engine-rs/src/thresholds.rs` returns nothing)
- [ ] AC7 — All 5 existing integration tests in `state.rs` pass:
  - `snapshot_none_until_both_inputs_arrive`
  - `ewma_smooths_across_ticks`
  - `transition_is_two_phase_with_hysteresis` (updated with `now` arg)
  - `pyth_confidence_label_buckets_high_medium_low`
  - `stale_pyth_reading_is_refused`
  - PLUS new test `transition_takes_explicit_now_argument`
- [ ] AC8 — `transition()` takes explicit `now: DateTime<Utc>` parameter; no internal `Utc::now()` call
- [ ] AC9 — `try_recompute` reads `Utc::now()` once and threads through all downstream calls

---

## Cross-references

- For methodology spec, see `../05-methodology-crate.md`.
- For full engine architecture, see `../06-engine-changes.md`.
- For Phase 3 (next phase) building on this refactor, see `04-phase-3-audit-persistence.md`.
