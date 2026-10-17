# Persistence / time-below-peg signal — Implementation Plan (Spec 03, Option A)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Track, per asset, how long it has resided in its CURRENT committed FSM band (`band_since`), and derive a `current_state_duration_secs` + a `sustained` boolean (true only for a real alerting band held ≥ N). Surface both as enrichment on the alert event. This closes the confirmed blind spot: a months-long ~2% DRIFT (sUSD/Hylo mechanism depeg) is now distinguished from a 5-minute blip — with ZERO methodology/receipt/replay impact.

**Architecture:** `band_since: Option<DateTime<Utc>>` added to `AssetRuntime`, set in `transition()` on a committed band change and reset by `force_unknown()`, persisted in `engine_state_snapshot` (migration 0057). The keep/drop rule is a PURE function `sustained_for(state, duration)` that returns false for PEGGED/UNKNOWN regardless of duration — structurally sidestepping the ADR-0024 freeze-detector trap. The signal is engine runtime + `event.extra` only; it never enters `InputsFrozen`/`Computed`, so the receipt hash is unchanged.

**Tech Stack:** Rust, sqlx/Postgres, chrono, pegana_common::PegState. Spec: `docs/superpowers/specs/2026-06-24-03-persistence-time-below-peg-signal.md`. ADR to add: **0027**. Migration: **0057** (overview `…00`).

**Branch:** `feat/persistence-time-below-peg` off `main`.

**Scope guard:** engine core + migration 0057 + `AlertEvent.extra` surfacing (this already reaches webhooks + the alerts/audit row). The display fan-out (`/v1/assets` field, bot "in DRIFT for 3 months" string, web badge) is a SEPARATE follow-up (Spec 03b) — NOT this plan. Do NOT change `crates/methodology` or the receipt; do NOT touch `InputsFrozen`/`Computed`/`receipt.rs`.

## THE central constraint (ADR-0024)

A constant/illiquid asset sits at a flat small discount for hours (ONyc ~20h, vSOL 6.5h, even USDC 67min) — that is NOT broken. The `sustained` signal is safe ONLY because it keys on residence in a committed ALERTING band (DRIFT/DEPEG/CRITICAL/BLACK_SWAN). A PEGGED/UNKNOWN asset is NEVER `sustained` regardless of discount magnitude, constancy, or elapsed time. This is enforced by the pure `sustained_for` (Task 2) and proven by its test.

---

### Task 1: migration `0057_engine_state_band_since.sql`

**Files:** Create `migrations/0057_engine_state_band_since.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Spec 03 (persistence / time-below-peg). band_since = when the asset last
-- ENTERED its current committed FSM band. Nullable: unknown until the first
-- committed transition, and NULL for a pre-migration row (→ treated as
-- "not sustained" until the next genuine transition stamps it). Engine runtime
-- cache, NOT a replay input (same as the rest of engine_state_snapshot,
-- ADR-0010) — it does NOT enter the receipt.
ALTER TABLE engine_state_snapshot ADD COLUMN band_since TIMESTAMPTZ;
```

- [ ] **Step 2: Commit**

```bash
git add migrations/0057_engine_state_band_since.sql
git commit -m "feat(db): migration 0057 — engine_state_snapshot.band_since (time-below-peg)"
```

---

### Task 2: `band_since` field + pure `sustained_for` + `band_duration` (with the ADR-0024 guard test)

**Files:** Modify `crates/engine-rs/src/state.rs`

- [ ] **Step 1: Write the failing test** (add to the `#[cfg(test)]` area of `state.rs`; this is the ADR-0024 guard)

```rust
#[cfg(test)]
mod time_below_peg_tests {
    use super::*;

    #[test]
    fn sustained_keys_only_on_committed_alerting_band() {
        use pegana_common::PegState::*;
        let huge = Some(10 * 365 * 24 * 3600_i64); // 10 years
        // PEGGED / UNKNOWN are NEVER sustained — the ADR-0024 guard.
        assert!(!sustained_for(Pegged, huge));
        assert!(!sustained_for(Unknown, huge));
        // None duration (unknown / pre-migration) → never sustained.
        assert!(!sustained_for(Drift, None));
        // DRIFT: sustained only at/after the 6h threshold.
        assert!(!sustained_for(Drift, Some(6 * 3600 - 1)));
        assert!(sustained_for(Drift, Some(6 * 3600)));
        // Severe bands: sustained at/after 1h.
        assert!(!sustained_for(Depeg, Some(3600 - 1)));
        assert!(sustained_for(Depeg, Some(3600)));
        assert!(sustained_for(Critical, Some(3600)));
        assert!(sustained_for(BlackSwan, Some(3600)));
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p engine-rs time_below_peg_tests::sustained_keys_only_on_committed_alerting_band`
Expected: FAIL to COMPILE — `cannot find function sustained_for`.

- [ ] **Step 3a: Add the `band_since` field** to `AssetRuntime` (`state.rs`, immediately after `last_liquidity_usd`, ~line 77)

```rust
    /// When the asset last ENTERED its current committed FSM band (set in
    /// `transition` on a committed state change; reset to None by `force_unknown`).
    /// Drives the time-below-peg `sustained` signal (Spec 03). Persisted in
    /// engine_state_snapshot; NOT a receipt input (ADR-0010). None = duration
    /// unknown (pre-first-transition / pre-migration row) → never `sustained`.
    pub band_since: Option<DateTime<Utc>>,
```

Extend the `SnapshotRow` tuple (`state.rs:17-23`) with a 6th element:

```rust
type SnapshotRow = (
    String,
    Option<Decimal>,
    Option<String>,
    Option<DateTime<Utc>>,
    String,
    Option<DateTime<Utc>>, // band_since
);
```

- [ ] **Step 3b: Add the pure helpers + the `band_duration` method** (add to `state.rs`; the free fns near the top, the method inside the `impl EngineState`)

```rust
/// The committed bands that represent a real alert (DRIFT and worse). PEGGED and
/// UNKNOWN are deliberately excluded — that is the ADR-0024 guard.
fn is_alerting(s: PegState) -> bool {
    matches!(
        s,
        PegState::Drift | PegState::Depeg | PegState::Critical | PegState::BlackSwan
    )
}

/// Per-band "sustained" threshold in seconds. DRIFT is the slow mechanism-depeg
/// case (long: 6h — longer than any routine intra-day band excursion in the
/// calibration data). DEPEG/CRITICAL/BLACK_SWAN are alarming the moment they
/// persist at all (1h). PEGGED/UNKNOWN never qualify.
fn sustained_threshold_secs(s: PegState) -> i64 {
    match s {
        PegState::Drift => 6 * 3600,
        PegState::Depeg | PegState::Critical | PegState::BlackSwan => 3600,
        PegState::Pegged | PegState::Unknown => i64::MAX,
    }
}

/// Pure `sustained` decision. Keys ONLY on committed alerting-band residence:
/// PEGGED/UNKNOWN are NEVER sustained regardless of duration (ADR-0024), and an
/// unknown duration (None) is never sustained (ADR-0019 — missing ≠ confirming).
fn sustained_for(state: PegState, duration_secs: Option<i64>) -> bool {
    match duration_secs {
        Some(s) => is_alerting(state) && s >= sustained_threshold_secs(state),
        None => false,
    }
}
```

And inside `impl EngineState` (next to `last_state`, ~line 553):

```rust
    /// Duration in the current committed band + whether it is a SUSTAINED
    /// alerting episode. Reads the committed `last_state` + `band_since`. Safe
    /// by construction: a PEGGED/UNKNOWN asset is never `sustained` (see
    /// `sustained_for`). Surfaced as enrichment on the alert event — NOT in the
    /// receipt.
    pub async fn band_duration(&self, sym: &str, now: DateTime<Utc>) -> (Option<i64>, bool) {
        let rt = self.rt(sym).await;
        let g = rt.read().await;
        let secs = g.band_since.map(|t| (now - t).num_seconds().max(0));
        (secs, sustained_for(g.last_state, secs))
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p engine-rs time_below_peg_tests::sustained_keys_only_on_committed_alerting_band`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/engine-rs/src/state.rs
git commit -m "feat(engine): band_since field + pure sustained_for + band_duration (ADR-0024-safe)"
```

---

### Task 3: stamp/reset `band_since` in `transition` + `force_unknown`

**Files:** Modify `crates/engine-rs/src/state.rs`

- [ ] **Step 1: Stamp on committed transition** — in `transition()` (`state.rs:523-526`), capture the prior committed state and stamp `band_since` only when the committed state actually changes:

Replace:
```rust
        g.last_state = decision.new_last_state;
        g.candidate_state = decision.new_candidate_state;
        g.candidate_since = decision.new_candidate_since;
        g.last_state
```
with:
```rust
        // Spec 03: stamp band_since ONLY on a committed band change (not on
        // candidate staging) so the duration reflects residence in the CURRENT
        // committed state. A flapping candidate must not reset the clock.
        let prev_committed = g.last_state;
        g.last_state = decision.new_last_state;
        g.candidate_state = decision.new_candidate_state;
        g.candidate_since = decision.new_candidate_since;
        if decision.new_last_state != prev_committed {
            g.band_since = Some(now);
        }
        g.last_state
```

- [ ] **Step 2: Reset on `force_unknown`** — in `force_unknown()` (`state.rs:540-542`), add the band_since reset:

Replace:
```rust
        g.last_state = PegState::Unknown;
        g.candidate_state = None;
        g.candidate_since = None;
```
with:
```rust
        g.last_state = PegState::Unknown;
        g.candidate_state = None;
        g.candidate_since = None;
        // Spec 03: UNKNOWN is a committed band change → duration resets. (Known
        // interaction: a transient NAV-sanity UNKNOWN resets a sustained DRIFT's
        // clock; honest — UNKNOWN means "we don't know" — and acceptable per the
        // overview hazard note.)
        g.band_since = None;
```

- [ ] **Step 3: Write + run the reset test** (integration test modeled on the existing `integration_tests` harness in `state.rs:743+` — build an `EngineState`, drive `transition`, read `band_duration`)

```rust
    #[tokio::test]
    async fn band_since_stamps_on_commit_and_resets_on_unknown() {
        use pegana_common::PegState::*;
        // Build a single-asset EngineState via the same helper the existing
        // integration_tests use (see state.rs `integration_tests` mod for the
        // exact constructor). Call it `eng` with one asset "X".
        let eng = test_engine_with_asset("X").await;
        let t0 = "2026-06-24T00:00:00Z".parse::<DateTime<Utc>>().unwrap();

        // Commit Pegged -> Drift (confirm_up_secs = 0 commits immediately).
        eng.transition("X", Drift, t0, 0, 0).await;
        let later = t0 + chrono::Duration::hours(7);
        let (secs, sustained) = eng.band_duration("X", later).await;
        assert_eq!(secs, Some(7 * 3600));
        assert!(sustained, "7h in DRIFT >= 6h => sustained");

        // force_unknown resets the clock.
        eng.force_unknown("X").await;
        let (secs2, sustained2) = eng.band_duration("X", later).await;
        assert_eq!(secs2, None);
        assert!(!sustained2);
    }
```
> If the `integration_tests` mod has no reusable single-asset constructor, add a tiny `test_engine_with_asset` helper there following its existing build pattern.

- [ ] **Step 4: Run**

Run: `cargo test -p engine-rs band_since_stamps_on_commit_and_resets_on_unknown`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/engine-rs/src/state.rs
git commit -m "feat(engine): stamp band_since on committed transition, reset on force_unknown"
```

---

### Task 4: persist `band_since` across restart

**Files:** Modify `crates/engine-rs/src/state.rs` (`load_from_pg`, `snapshot_to_pg`)

- [ ] **Step 1: Persist in `snapshot_to_pg`** (`state.rs:686-701`) — add the column to INSERT, the ON CONFLICT UPDATE, and the bind:

In the INSERT column list add `band_since`; in VALUES add `$6` and shift `NOW()` to `$7`-free (keep `NOW()`); in the UPDATE set-list add `band_since = EXCLUDED.band_since`; and add `.bind(g.band_since)` after `.bind(last_state_str)`. The full statement becomes:

```rust
        sqlx::query(
            "INSERT INTO engine_state_snapshot \
                 (asset, ewma_discount, candidate_state, candidate_since, last_state, band_since, updated_at) \
             VALUES ($1, $2, $3, $4, $5, $6, NOW()) \
             ON CONFLICT (asset) DO UPDATE SET \
                 ewma_discount   = EXCLUDED.ewma_discount, \
                 candidate_state = EXCLUDED.candidate_state, \
                 candidate_since = EXCLUDED.candidate_since, \
                 last_state      = EXCLUDED.last_state, \
                 band_since      = EXCLUDED.band_since, \
                 updated_at      = EXCLUDED.updated_at",
        )
        .bind(sym)
        .bind(g.ewma_discount)
        .bind(candidate_str)
        .bind(g.candidate_since)
        .bind(last_state_str)
        .bind(g.band_since)
        .execute(pg)
```

- [ ] **Step 2: Hydrate in `load_from_pg`** (`state.rs:638-672`) — add `band_since` to the SELECT and the destructuring, and assign it:

Change the query to `SELECT asset, ewma_discount, candidate_state, candidate_since, last_state, band_since FROM engine_state_snapshot`; change the loop binding to `for (asset, ewma, candidate, candidate_since, last, band_since) in rows {`; and inside the loop (after `g.candidate_since = candidate_since;`) add:

```rust
            g.band_since = band_since;
```
(A pre-migration NULL row hydrates `band_since = None` → "duration unknown → not sustained" until the next genuine transition stamps it. Honest per ADR-0019.)

- [ ] **Step 3: Verify compile + the prior tests still pass**

Run: `cargo test -p engine-rs time_below_peg_tests band_since_stamps`
Expected: PASS (round-trip persistence is exercised live post-deploy; the in-memory logic is covered above).

- [ ] **Step 4: Commit**

```bash
git add crates/engine-rs/src/state.rs
git commit -m "feat(engine): persist + hydrate band_since in engine_state_snapshot"
```

---

### Task 5: surface duration + sustained on the alert event

**Files:** Modify `crates/engine-rs/src/main.rs`

- [ ] **Step 1: Compute + add to `event.extra`** — in `try_recompute`, just before the `let event = AlertEvent {` build (`main.rs:966`), compute the duration; then add two keys to the `extra: serde_json::json!({ … })` block (`main.rs:976-995`, alongside `liquidity_usd`):

Before the `AlertEvent` literal:
```rust
    // Spec 03: time-below-peg enrichment. final_state is already committed into
    // last_state by transition()/force_unknown() above, so band_duration reflects
    // the published state. Server-only metadata — NOT part of the receipt.
    let (band_dur_secs, sustained) = engine.band_duration(asset, now).await;
```
Inside the `extra` json (add two entries):
```rust
                "current_state_duration_secs": band_dur_secs,
                "sustained": sustained,
```

- [ ] **Step 2: Verify the crate**

Run: `cargo fmt -p engine-rs && cargo clippy -p engine-rs --all-targets -- -D warnings && cargo test -p engine-rs`
Expected: fmt clean, clippy clean, all engine tests PASS.

- [ ] **Step 3: Commit**

```bash
git add crates/engine-rs/src/main.rs
git commit -m "feat(engine): surface current_state_duration_secs + sustained on alert event.extra"
```

---

## Final verification (before a PR)

- [ ] `cargo fmt -p engine-rs --check`
- [ ] `cargo clippy -p engine-rs --all-targets -- -D warnings`
- [ ] `cargo test -p engine-rs` (incl. the ADR-0024 guard `sustained_keys_only_on_committed_alerting_band`)
- [ ] **Receipt unchanged:** `cargo test -p pegana-methodology` green AND `git --no-pager diff main -- crates/methodology` is EMPTY (band_since never touches the methodology crate / the receipt). This is the proof there is NO methodology/replay impact.
- [ ] `git --no-pager diff --stat` shows ONLY: `migrations/0057_engine_state_band_since.sql`, `crates/engine-rs/src/state.rs`, `crates/engine-rs/src/main.rs`
- [ ] NO change under `crates/methodology/` or `crates/api-rs/`

> **Cannot be verified headlessly (deploy-time):** the `band_since` column round-tripping through a real restart, and a real months-long DRIFT accruing duration. Post-deploy (engine recreate + migration 0057): confirm `engine_state_snapshot.band_since` populates on the next transition, and that no PEGGED asset ever shows `sustained:true` in an alert payload.

## Self-Review (against the spec)

- `band_since` keyed on committed band crossing; PEGGED/UNKNOWN never sustained → Task 2 `sustained_for` + its guard test. ✓
- Stamp on commit, not candidate staging; reset on force_unknown → Task 3. ✓
- Persist + hydrate (no reset-on-restart) → Task 4; NULL row → not-sustained. ✓
- Surface as enrichment (webhook/audit via event.extra) → Task 5. ✓
- NO methodology/receipt/replay impact → final verification (methodology diff empty). ✓
- **No placeholders:** implementation code complete; the one harness-dependent test (Task 3) points at the existing `integration_tests` mod for the constructor. **Type consistency:** `sustained_for(PegState, Option<i64>) -> bool`, `band_duration(&str, DateTime<Utc>) -> (Option<i64>, bool)`, `SnapshotRow` 6-tuple — consistent across tasks.
- **Out of scope (deferred → Spec 03b):** `/v1/assets` `current_state_duration_secs`/`sustained` field, bot "in DRIFT for N" rendering, web "time in state" badge. Spec 06's attestation consumes `sustained` (overview hazard #5) — wire when Spec 06 lands.
